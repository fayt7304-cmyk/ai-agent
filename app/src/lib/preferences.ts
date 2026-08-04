// User preferences: animations, fonts, voice settings
// Stored in localStorage and applied to the document

export type AnimationLevel = "none" | "reduced" | "normal";
export type FontFamily = "system" | "serif" | "monospace" | "rounded";
export type VoiceLanguage = "en" | "es" | "fr" | "de" | "it" | "pt" | "ja" | "zh";
export type VoiceStyle = "natural" | "formal" | "friendly" | "calm";

export interface Preferences {
  animationLevel: AnimationLevel;
  fontFamily: FontFamily;
  fontSize: number; // 12-18px
  voiceLanguage: VoiceLanguage;
  voiceStyle: VoiceStyle;
  voiceSpeed: number; // 0.5-2.0
}

const STORAGE_KEY = "paul_preferences";

const DEFAULT_PREFS: Preferences = {
  animationLevel: "normal",
  fontFamily: "system",
  fontSize: 14,
  voiceLanguage: "en",
  voiceStyle: "natural",
  voiceSpeed: 1.0,
};

function getStoredPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_PREFS;
}

function savePreferences(prefs: Preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function applyAnimationLevel(level: AnimationLevel) {
  document.documentElement.style.setProperty("--anim-level", level);
  if (level === "none") {
    document.documentElement.style.setProperty("--transition-duration", "0s");
  } else if (level === "reduced") {
    document.documentElement.style.setProperty("--transition-duration", "0.15s");
  } else {
    document.documentElement.style.setProperty("--transition-duration", "0.3s");
  }
}

function applyFontFamily(family: FontFamily) {
  let fontStack = "system-ui, -apple-system, sans-serif";
  if (family === "serif") {
    fontStack = "'Georgia', 'Times New Roman', serif";
  } else if (family === "monospace") {
    fontStack = "'Fira Code', 'Consolas', 'Monaco', monospace";
  } else if (family === "rounded") {
    fontStack = "'Quicksand', 'Nunito', 'system-ui', sans-serif";
  }
  document.documentElement.style.setProperty("--font-family", fontStack);
}

function applyVoiceSettings(prefs: Preferences) {
  // SpeechSynthesis is handled in chat-view.ts using getPreferences()
  // This is a hook for any other voice-related global state if needed.
}

function applyFontSize(size: number) {
  document.documentElement.style.setProperty("--base-font-size", `${size}px`);
}

export function initPreferences() {
  const prefs = getStoredPreferences();
  applyAnimationLevel(prefs.animationLevel);
  applyFontFamily(prefs.fontFamily);
  applyFontSize(prefs.fontSize);
  applyVoiceSettings(prefs);
}

export function getPreferences(): Preferences {
  return getStoredPreferences();
}

export function updateAnimationLevel(level: AnimationLevel) {
  const prefs = getStoredPreferences();
  prefs.animationLevel = level;
  savePreferences(prefs);
  applyAnimationLevel(level);
}

export function updateFontFamily(family: FontFamily) {
  const prefs = getStoredPreferences();
  prefs.fontFamily = family;
  savePreferences(prefs);
  applyFontFamily(family);
}

export function updateFontSize(size: number) {
  const size_clamped = Math.max(12, Math.min(18, size));
  const prefs = getStoredPreferences();
  prefs.fontSize = size_clamped;
  savePreferences(prefs);
  applyFontSize(size_clamped);
}

export function updateVoiceLanguage(lang: VoiceLanguage) {
  const prefs = getStoredPreferences();
  prefs.voiceLanguage = lang;
  savePreferences(prefs);
  applyVoiceSettings(prefs);
}

export function updateVoiceStyle(style: VoiceStyle) {
  const prefs = getStoredPreferences();
  prefs.voiceStyle = style;
  savePreferences(prefs);
  applyVoiceSettings(prefs);
}

export function updateVoiceSpeed(speed: number) {
  const speed_clamped = Math.max(0.5, Math.min(2.0, speed));
  const prefs = getStoredPreferences();
  prefs.voiceSpeed = speed_clamped;
  savePreferences(prefs);
  applyVoiceSettings(prefs);
}
