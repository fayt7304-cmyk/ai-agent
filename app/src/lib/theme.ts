type ThemePreference = "light" | "dark" | "system";

const MODES: ThemePreference[] = ["light", "dark", "system"];
const LABELS: Record<ThemePreference, string> = {
  light: "☀️ Light",
  dark: "🌙 Dark",
  system: "🖥️ System",
};

function currentPreference(): ThemePreference {
  return (localStorage.getItem("theme-preference") as ThemePreference) || "system";
}

function resolve(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return preference;
}

export function initTheme(): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;

  function apply(preference: ThemePreference) {
    document.documentElement.dataset.theme = resolve(preference);
    btn!.textContent = LABELS[preference];
  }

  btn.addEventListener("click", () => {
    const current = currentPreference();
    const next = MODES[(MODES.indexOf(current) + 1) % MODES.length];
    localStorage.setItem("theme-preference", next);
    apply(next);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentPreference() === "system") apply("system");
  });

  apply(currentPreference());
}
