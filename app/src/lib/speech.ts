/**
 * Text-to-speech for Paul's replies.
 *
 * Two paths:
 *  - "High-quality voice" ON  → POST /api/tts, which proxies a studio voice
 *    (ElevenLabs multilingual) server-side so the API key never reaches the
 *    browser. Returns MP3 audio we play with an <audio> element.
 *  - OFF (or the proxy is unavailable) → the browser's built-in
 *    speechSynthesis voice, exactly as before.
 */

import { API_BASE } from "../api";
import { getPreferences, type VoiceStyle } from "./preferences";

/** Studio voices chosen to roughly match each "voice style" option. */
const VOICE_IDS: Record<VoiceStyle, string> = {
  natural: "EXAVITQu4vr4xnSDxMaL", // Sarah
  formal: "JBFqnCBsd6RMkjVDRZzb", // George
  friendly: "FGY2WhTYpPnrIDTdsKH5", // Laura
  calm: "XrExE9yKIg1WjnnlVkGX", // Matilda
};

let currentAudio: HTMLAudioElement | null = null;

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

/** Stop anything currently being read aloud, on either path. */
export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

function speakWithBrowser(text: string, onEnd?: () => void): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      onEnd?.();
      resolve();
      return;
    }
    const prefs = getPreferences();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = prefs.voiceLanguage;
    utter.rate = prefs.voiceSpeed;
    const finish = () => {
      onEnd?.();
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}

async function speakWithProxy(text: string, onEnd?: () => void): Promise<void> {
  const prefs = getPreferences();
  const resp = await fetch(`${API_BASE}/api/tts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voiceId: VOICE_IDS[prefs.voiceStyle] || VOICE_IDS.natural,
      language: prefs.voiceLanguage,
      speed: prefs.voiceSpeed,
    }),
  });
  if (!resp.ok) throw new Error(`TTS failed (${resp.status})`);

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;

  await new Promise<void>((resolve, reject) => {
    const done = (err?: unknown) => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      if (err) {
        // Let the caller fall back to the device voice; onEnd fires there instead.
        reject(err);
        return;
      }
      onEnd?.();
      resolve();
    };
    audio.onended = () => done();
    audio.onerror = () => done(new Error("Audio playback failed"));
    audio.play().catch((e) => done(e));
  });
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

  if (!getPreferences().highQualityVoice) {
    return speakWithBrowser(text, opts.onEnd);
  }

  try {
    await speakWithProxy(text, opts.onEnd);
  } catch {
    // The studio voice needs a configured server key; quietly fall back rather
    // than leaving the user with no audio at all.
    await speakWithBrowser(text, opts.onEnd);
  }
}
