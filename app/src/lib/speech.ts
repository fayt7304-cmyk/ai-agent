/**
 * Text-to-speech for Paul's replies.
 *
 * Two paths:
 *  - "High-quality voice" ON  → POST /api/tts, which proxies a studio voice
 *    (ElevenLabs multilingual) server-side so the API key never reaches the
 *    browser. Returns MP3 audio we play with an <audio> element.
 *  - OFF (or the proxy is unavailable) → the browser's built-in
 *    speechSynthesis voice, exactly as before.
 *
 * Two things used to go wrong and are handled explicitly here:
 *  1. The studio request is slower than the device voice, so the old code could
 *     start the device voice *and* then let the studio clip play on top of it.
 *     Every speak() call now owns a generation id: a late studio response from
 *     an older generation is thrown away instead of played.
 *  2. A slow-but-successful request surfaced as "the service didn't respond".
 *     The request now has a generous abort timeout and the fallback notice is
 *     only emitted when nothing was spoken by the studio voice at all.
 */

import { API_BASE, authHeaders } from "../api";
import { getPreferences, type VoiceStyle } from "./preferences";

/** Studio voices chosen to roughly match each "voice style" option. */
const VOICE_IDS: Record<VoiceStyle, string> = {
  natural: "EXAVITQu4vr4xnSDxMaL", // Sarah
  formal: "JBFqnCBsd6RMkjVDRZzb", // George
  friendly: "FGY2WhTYpPnrIDTdsKH5", // Laura
  calm: "XrExE9yKIg1WjnnlVkGX", // Matilda
};

/** How long to wait for the studio clip before giving up on it. Generous on
 *  purpose: the previous short wait was what produced the "didn't respond"
 *  warning on perfectly good (just slow) requests. */
const TTS_TIMEOUT_MS = 45000;

/** Minimum wait (ms) before the system voice reader is allowed to start as a
 *  fallback. This prevents the device voice from firing immediately while the
 *  studio request is still in-flight on a slow connection. */
const SYSTEM_VOICE_FALLBACK_DELAY_MS = 800;

let currentAudio: HTMLAudioElement | null = null;
let currentAbort: AbortController | null = null;
/** Incremented on every speak()/stopSpeaking(); anything from an older
 *  generation must not produce sound. */
let generation = 0;

/** Thrown when the studio-voice proxy can't serve audio (not configured, upstream error…). */
export class TtsUnavailableError extends Error {
  status: number;
  constructor(status: number) {
    super(`TTS unavailable (${status})`);
    this.status = status;
  }
}

/** Strip markdown so the voice doesn't read out asterisks and backticks. */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Hard-stop the studio clip (and cancel an in-flight request for it). */
function killStudioAudio() {
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.removeAttribute("src");
      currentAudio.load();
    } catch {
      // element already detached — nothing to do
    }
    currentAudio = null;
  }
}

/** Stop anything currently being read aloud, on either path. */
export function stopSpeaking() {
  generation++;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  killStudioAudio();
}

function speakWithBrowser(text: string, myGen: number, onEnd?: () => void): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || myGen !== generation) {
      if (myGen === generation) onEnd?.();
      resolve();
      return;
    }
    const prefs = getPreferences();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = prefs.voiceLanguage;
    utter.rate = prefs.voiceSpeed;
    const finish = () => {
      if (myGen === generation) onEnd?.();
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}

/**
 * Fetch and play the studio clip.
 * Resolves once playback finished. Rejects only when nothing was played, so the
 * caller can fall back to the device voice without ever doubling up.
 */
async function speakWithProxy(text: string, myGen: number, onEnd?: () => void): Promise<void> {
  const prefs = getPreferences();
  const abort = new AbortController();
  currentAbort = abort;
  const timer = setTimeout(() => abort.abort(), TTS_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/api/tts`, {
      method: "POST",
      credentials: "include",
      signal: abort.signal,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        text,
        voiceId: VOICE_IDS[prefs.voiceStyle] || VOICE_IDS.natural,
        language: prefs.voiceLanguage,
        speed: prefs.voiceSpeed,
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (currentAbort === abort) currentAbort = null;

  // The user pressed stop (or started another message) while we were waiting:
  // stay silent instead of talking over whatever is happening now.
  if (myGen !== generation) throw new TtsUnavailableError(0);
  if (!resp.ok) throw new TtsUnavailableError(resp.status);

  const blob = await resp.blob();
  if (myGen !== generation) throw new TtsUnavailableError(0);
  if (!blob.size) throw new TtsUnavailableError(502);

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: unknown) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
        if (err) {
          reject(err);
          return;
        }
        if (myGen === generation) onEnd?.();
        resolve();
      };
      audio.onended = () => done();
      audio.onerror = () => done(new Error("Audio playback failed"));
      audio
        .play()
        .then(() => {
          // Playback really started — this generation now owns the speaker.
          if (myGen === generation) currentAudio = audio;
          else done(new Error("superseded"));
        })
        .catch((e) => done(e));
    });
  } catch (e) {
    try {
      audio.pause();
    } catch {
      // ignore
    }
    throw e;
  }
}

/**
 * Read text aloud using the user's chosen voice path.
 * Falls back to the device voice if the studio proxy isn't available.
 */
export async function speak(markdown: string, opts: { onEnd?: () => void } = {}): Promise<void> {
  const text = toPlainText(markdown);
  if (!text) {
    opts.onEnd?.();
    return;
  }

  stopSpeaking();
  const myGen = generation;

  if (!getPreferences().highQualityVoice) {
    return speakWithBrowser(text, myGen, opts.onEnd);
  }

  try {
    await speakWithProxy(text, myGen, opts.onEnd);
    return;
  } catch (err) {
    // Superseded or stopped: another generation owns the speaker now, so this
    // one must not start the device voice on top of it.
    if (myGen !== generation) return;

    const aborted = err instanceof DOMException && err.name === "AbortError";
    const status = err instanceof TtsUnavailableError ? err.status : 0;

    // 501 = the studio voice simply isn't configured on this deployment. That's a
    // known state, not a fault worth interrupting the conversation for, so the
    // device voice takes over silently. 0 means "we chose not to play" (stopped
    // or superseded) — also nothing to announce.
    if (status !== 501 && status !== 0) {
      document.dispatchEvent(
        new CustomEvent("tts-fallback", { detail: { status, timeout: aborted } })
      );
    } else if (aborted) {
      document.dispatchEvent(new CustomEvent("tts-fallback", { detail: { status: 0, timeout: true } }));
    }

    killStudioAudio();
    // Wait a short moment before starting the system voice reader. This ensures
    // we don't accidentally double-up if the studio audio is still cleaning up,
    // and gives the user a brief pause that feels intentional rather than abrupt.
    await new Promise<void>((resolve) => setTimeout(resolve, SYSTEM_VOICE_FALLBACK_DELAY_MS));
    if (myGen !== generation) return; // superseded during the wait
    await speakWithBrowser(text, myGen, opts.onEnd);
  }
}
