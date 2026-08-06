/**
 * Text-to-speech for Paul's replies.
 *
 * Two paths:
 *  - "High-quality voice" ON  → POST /api/tts (studio voice proxy).
 *  - OFF (or proxy unavailable) → browser speechSynthesis.
 *
 * Latency notes:
 *  - Browser voices are warmed and cached at startup so the first "Read aloud"
 *    does not wait on voiceschanged.
 *  - Voice pick is cached per language code.
 *  - While a studio request is in flight, browser voices are warmed in parallel
 *    so a fallback can start immediately after the settle delay.
 *  - Settle delay is short for "not configured" (501) and longer for real errors.
 */

import { API_BASE, authHeaders } from "../api";
import { getPreferences, type VoiceStyle } from "./preferences";

const VOICE_IDS: Record<VoiceStyle, string> = {
  natural: "EXAVITQu4vr4xnSDxMaL", // Sarah
  formal: "JBFqnCBsd6RMkjVDRZzb", // George
  friendly: "FGY2WhTYpPnrIDTdsKH5", // Laura
  calm: "XrExE9yKIg1WjnnlVkGX", // Matilda
};

const TTS_TIMEOUT_MS = 45000;

/** Settle delay after a hard studio failure before system voice. */
const SYSTEM_VOICE_FALLBACK_DELAY_MS = 1200;
/** Faster settle when the deployment simply has no studio voice (501). */
const SYSTEM_VOICE_QUICK_FALLBACK_MS = 350;

let currentAudio: HTMLAudioElement | null = null;
let currentAbort: AbortController | null = null;
let generation = 0;

/** Cached voice list + per-lang picks (invalidated on voiceschanged). */
let cachedVoices: SpeechSynthesisVoice[] | null = null;
const voiceByLang = new Map<string, SpeechSynthesisVoice | null>();
let voicesWarmPromise: Promise<void> | null = null;

export class TtsUnavailableError extends Error {
  status: number;
  constructor(status: number) {
    super(`TTS unavailable (${status})`);
    this.status = status;
  }
}

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
      // ignore
    }
    currentAudio = null;
  }
}

function killBrowserVoice() {
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export function stopSpeaking() {
  generation++;
  killBrowserVoice();
  killStudioAudio();
}

function invalidateVoiceCache() {
  cachedVoices = null;
  voiceByLang.clear();
}

function readVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  if (cachedVoices && cachedVoices.length) return cachedVoices;
  const list = window.speechSynthesis.getVoices();
  if (list.length) cachedVoices = list;
  return list;
}

/**
 * Score voices so we prefer local, matching-language, high-quality engines
 * (e.g. Google / Microsoft / Apple) over remote/slow ones.
 */
function scoreVoice(v: SpeechSynthesisVoice, lang: string, prefix: string): number {
  let score = 0;
  const vLang = (v.lang || "").toLowerCase();
  if (vLang === lang.toLowerCase()) score += 100;
  else if (vLang.startsWith(prefix)) score += 60;
  else if (vLang.split("-")[0] === prefix) score += 40;
  else return -1;

  if (v.localService) score += 25;
  if (v.default) score += 5;

  const name = (v.name || "").toLowerCase();
  // Prefer known quality engines slightly; penalize novelty/remote-sounding names.
  if (/google|microsoft|apple|samantha|daniel|karen|thomas|nicky|zira|david/.test(name)) score += 10;
  if (/remote|network|compact/.test(name)) score -= 5;
  return score;
}

function pickBrowserVoice(lang: string): SpeechSynthesisVoice | null {
  if (voiceByLang.has(lang)) return voiceByLang.get(lang) ?? null;

  const voices = readVoices();
  if (!voices.length) {
    voiceByLang.set(lang, null);
    return null;
  }

  const prefix = (lang.split("-")[0] || lang).toLowerCase();
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = scoreVoice(v, lang, prefix);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  if (!best) best = voices.find((v) => v.default) || voices[0] || null;
  voiceByLang.set(lang, best);
  return best;
}

/**
 * Warm the speechSynthesis voice list as early as possible so the first
 * speak() call does not block on voiceschanged.
 */
export function warmBrowserVoices(): Promise<void> {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  if (voicesWarmPromise) return voicesWarmPromise;

  voicesWarmPromise = new Promise((resolve) => {
    const finish = () => {
      readVoices();
      // Pre-cache the current preference language.
      try {
        pickBrowserVoice(getPreferences().voiceLanguage);
      } catch {
        // prefs may not be ready in edge cases
      }
      resolve();
    };

    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      cachedVoices = existing;
      finish();
      return;
    }

    const onChange = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      finish();
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    // Kick Chrome/Edge into loading the list.
    try {
      window.speechSynthesis.getVoices();
    } catch {
      // ignore
    }
    setTimeout(finish, 400);
  });

  // Keep cache fresh if the engine replaces the list later.
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    invalidateVoiceCache();
    readVoices();
    try {
      pickBrowserVoice(getPreferences().voiceLanguage);
    } catch {
      // ignore
    }
  });

  return voicesWarmPromise;
}

/** Ensure voices are available; usually instant after warmBrowserVoices(). */
function ensureVoicesLoaded(): Promise<void> {
  if (readVoices().length) return Promise.resolve();
  return warmBrowserVoices();
}

function speakWithBrowser(text: string, myGen: number, onEnd?: () => void): Promise<void> {
  return new Promise(async (resolve) => {
    if (!("speechSynthesis" in window) || myGen !== generation) {
      if (myGen === generation) onEnd?.();
      resolve();
      return;
    }

    await ensureVoicesLoaded();
    if (myGen !== generation) {
      resolve();
      return;
    }

    killBrowserVoice();

    const prefs = getPreferences();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = prefs.voiceLanguage;
    utter.rate = prefs.voiceSpeed;
    const voice = pickBrowserVoice(prefs.voiceLanguage);
    if (voice) {
      utter.voice = voice;
      // Keep lang aligned with the chosen voice for engines that ignore voice.lang.
      if (voice.lang) utter.lang = voice.lang;
    }

    const finish = () => {
      if (myGen === generation) onEnd?.();
      resolve();
    };
    utter.onend = finish;
    utter.onerror = finish;
    window.speechSynthesis.speak(utter);
  });
}

async function speakWithProxy(text: string, myGen: number, onEnd?: () => void): Promise<void> {
  const prefs = getPreferences();
  const abort = new AbortController();
  currentAbort = abort;
  const timer = setTimeout(() => abort.abort(), TTS_TIMEOUT_MS);

  // Warm browser voices in parallel so a fallback does not pay load cost later.
  void warmBrowserVoices();

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
          if (myGen === generation) {
            currentAudio = audio;
            killBrowserVoice();
          } else {
            done(new Error("superseded"));
          }
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
    if (myGen !== generation) return;

    const aborted = err instanceof DOMException && err.name === "AbortError";
    const status = err instanceof TtsUnavailableError ? err.status : 0;

    if (status !== 501 && status !== 0) {
      document.dispatchEvent(
        new CustomEvent("tts-fallback", { detail: { status, timeout: aborted } })
      );
    } else if (aborted) {
      document.dispatchEvent(new CustomEvent("tts-fallback", { detail: { status: 0, timeout: true } }));
    }

    killStudioAudio();
    killBrowserVoice();

    // Adaptive settle: quick when studio simply isn't configured; longer on errors.
    const delay =
      status === 501 || status === 0
        ? SYSTEM_VOICE_QUICK_FALLBACK_MS
        : SYSTEM_VOICE_FALLBACK_DELAY_MS;
    await new Promise<void>((resolve) => setTimeout(resolve, delay));

    if (myGen !== generation) return;
    killBrowserVoice();
    if (myGen !== generation) return;

    await speakWithBrowser(text, myGen, opts.onEnd);
  }
}
