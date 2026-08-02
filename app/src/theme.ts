export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "mac_theme";

function resolveSystemTheme(): "light" | "dark" {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyResolvedTheme(theme: Theme) {
  const resolved = theme === "system" ? resolveSystemTheme() : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

/** Read the locally-stored preference (used before we know if anyone is logged in). */
export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

/** Apply + persist a theme choice locally. Call syncThemeToAccount separately to save it server-side. */
export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyResolvedTheme(theme);
}

/** Call once on startup, as early as possible, to avoid a flash of the wrong theme. */
export function initTheme() {
  applyResolvedTheme(getStoredTheme());

  // Keep "system" in sync with OS-level changes while the tab is open.
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (getStoredTheme() === "system") applyResolvedTheme("system");
    });
  }
}
