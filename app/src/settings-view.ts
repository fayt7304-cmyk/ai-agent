import { api, ApiError, type User } from "./api";
import { setTheme, type Theme } from "./theme";

const overlay = document.getElementById("settings-overlay") as HTMLDivElement;
const closeBtn = document.getElementById("settings-close-btn") as HTMLButtonElement;
const cancelBtn = document.getElementById("settings-cancel-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("settings-save-btn") as HTMLButtonElement;
const themeSegmented = document.getElementById("theme-segmented") as HTMLDivElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const instructionsInput = document.getElementById("instructions-input") as HTMLTextAreaElement;
const passwordInput = document.getElementById("new-password-input") as HTMLInputElement;
const settingsError = document.getElementById("settings-error") as HTMLDivElement;

let selectedTheme: Theme = "system";

function close() {
  overlay.style.display = "none";
  settingsError.textContent = "";
  passwordInput.value = "";
}

export function initSettingsView(onUserUpdated: (user: User) => void) {
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  themeSegmented.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedTheme = btn.dataset.themeOption as Theme;
      themeSegmented.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      // Live-preview the theme immediately.
      setTheme(selectedTheme);
    });
  });

  saveBtn.addEventListener("click", async () => {
    settingsError.textContent = "";
    saveBtn.disabled = true;
    try {
      const { user } = await api.updateSettings({
        theme: selectedTheme,
        model: modelSelect.value,
        instructions: instructionsInput.value,
        ...(passwordInput.value ? { password: passwordInput.value } : {}),
      });
      onUserUpdated(user);
      close();
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : "Could not save settings.";
    } finally {
      saveBtn.disabled = false;
    }
  });
}

export function openSettings(user: User) {
  selectedTheme = user.theme;
  themeSegmented.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeOption === user.theme);
  });
  modelSelect.value = user.model;
  instructionsInput.value = user.instructions;
  passwordInput.value = "";
  settingsError.textContent = "";
  overlay.style.display = "flex";
}
