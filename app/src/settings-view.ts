import { api, ApiError, type User } from "./api";
import { setTheme, type Theme } from "./theme";
import { setLang, getStoredLang, t, type Lang } from "./lib/i18n";
import { refreshConversations } from "./chat-view";
import { applyAvatar } from "./lib/avatar";
import { readFileAsDataUrl } from "./files";
import { showCropper } from "./lib/cropper";
import { getPreferences, updateAnimationLevel, updateFontFamily, updateFontSize, updateVoiceLanguage, updateVoiceStyle, updateVoiceSpeed, type AnimationLevel, type FontFamily, type VoiceLanguage, type VoiceStyle } from "./lib/preferences";

const overlay = document.getElementById("settings-overlay") as HTMLDivElement;
const closeBtn = document.getElementById("settings-close-btn") as HTMLButtonElement;
const themeSegmented = document.getElementById("theme-segmented") as HTMLDivElement;
const languageSelect = document.getElementById("language-select") as HTMLSelectElement;
const passwordInput = document.getElementById("new-password-input") as HTMLInputElement;
const setPasswordBtn = document.getElementById("set-password-btn") as HTMLButtonElement;
const settingsError = document.getElementById("settings-error") as HTMLDivElement;
const settingsSuccess = document.getElementById("settings-success") as HTMLDivElement;
const googleLinkStatus = document.getElementById("google-link-status") as HTMLSpanElement;
const googleLinkBtn = document.getElementById("google-link-btn") as HTMLAnchorElement;
const googleUnlinkBtn = document.getElementById("google-unlink-btn") as HTMLButtonElement;

const settingsNav = document.getElementById("settings-nav") as HTMLDivElement;
const settingsPanels = document.querySelectorAll<HTMLElement>(".settings-panel");

const navProfileAvatar = document.getElementById("nav-profile-avatar") as HTMLDivElement;
const navProfileUsername = document.getElementById("nav-profile-username") as HTMLDivElement;
const navProfileEmail = document.getElementById("nav-profile-email") as HTMLDivElement;
const profileUserId = document.getElementById("profile-user-id") as HTMLElement;
const copyUserIdBtn = document.getElementById("copy-user-id-btn") as HTMLButtonElement;
const deleteAllChatsBtn = document.getElementById("delete-all-chats-btn") as HTMLButtonElement;

// Voice settings
const voiceLanguageSelect = document.getElementById("voice-language-select") as HTMLSelectElement;
const voiceStyleSelect = document.getElementById("voice-style-select") as HTMLSelectElement;
const voiceSpeedSlider = document.getElementById("voice-speed-slider") as HTMLInputElement;
const voiceSpeedValue = document.getElementById("voice-speed-value") as HTMLDivElement;

// Animation & Font settings
const animationSegmented = document.getElementById("animation-segmented") as HTMLDivElement;
const fontFamilySelect = document.getElementById("font-family-select") as HTMLSelectElement;
const fontSizeSlider = document.getElementById("font-size-slider") as HTMLInputElement;
const fontSizeValue = document.getElementById("font-size-value") as HTMLDivElement;

// Data & Memory
const generateMemoryBtn = document.getElementById("generate-memory-btn") as HTMLButtonElement;
const exportDataBtn = document.getElementById("export-data-btn") as HTMLButtonElement;
const manageUploadsBtn = document.getElementById("manage-uploads-btn") as HTMLButtonElement;

const editProfileAvatar = document.getElementById("edit-profile-avatar") as HTMLDivElement;
const avatarUploadBtn = document.getElementById("avatar-upload-btn") as HTMLButtonElement;
const avatarFileInput = document.getElementById("avatar-file-input") as HTMLInputElement;
const avatarRemoveBtn = document.getElementById("avatar-remove-btn") as HTMLButtonElement;
const displayNameInput = document.getElementById("display-name-input") as HTMLInputElement;
const usernameInput = document.getElementById("username-input") as HTMLInputElement;
const saveProfileBtn = document.getElementById("save-profile-btn") as HTMLButtonElement;

let currentUser: User | null = null;
let pendingAvatar: string | null | undefined = undefined; // undefined = unchanged, null = remove

function close() {
  overlay.style.display = "none";
  settingsError.textContent = "";
  settingsSuccess.textContent = "";
  passwordInput.value = "";
  pendingAvatar = undefined;
}

function showTab(tab: string) {
  settingsNav.querySelectorAll<HTMLButtonElement>(".settings-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.settingsTab === tab);
  });
  settingsPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.settingsPanel === tab);
  });
}

function renderGoogleLinkState(user: User) {
  if (user.google_linked) {
    googleLinkStatus.textContent = t("settings.connected");
    googleLinkBtn.style.display = "none";
    googleUnlinkBtn.style.display = "inline";
  } else {
    googleLinkStatus.textContent = t("settings.notConnected");
    googleLinkBtn.style.display = "inline";
    googleUnlinkBtn.style.display = "none";
  }
}

function renderProfile(user: User) {
  applyAvatar(navProfileAvatar, user);
  navProfileUsername.textContent = user.username;
  navProfileEmail.textContent = user.email || t("settings.noEmail");
  profileUserId.textContent = user.id;

  applyAvatar(editProfileAvatar, user);
  avatarRemoveBtn.style.display = user.avatar ? "inline" : "none";
  displayNameInput.value = user.display_name || "";
  usernameInput.value = user.username;
  pendingAvatar = undefined;
}

export function initSettingsView(onUserUpdated: (user: User) => void) {
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  settingsNav.querySelectorAll<HTMLButtonElement>(".settings-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.settingsTab!));
  });

  // Language applies (and saves locally) the moment it's picked — same pattern as theme,
  // but kept device-local (localStorage) rather than synced to the account for now.
  languageSelect.value = getStoredLang();
  languageSelect.addEventListener("change", () => {
    setLang(languageSelect.value as Lang);
  });

  // Voice settings
  const prefs = getPreferences();
  voiceLanguageSelect.value = prefs.voiceLanguage;
  voiceLanguageSelect.addEventListener("change", () => {
    updateVoiceLanguage(voiceLanguageSelect.value as VoiceLanguage);
    settingsSuccess.textContent = "Voice language updated";
    settingsError.textContent = "";
  });

  voiceStyleSelect.value = prefs.voiceStyle;
  voiceStyleSelect.addEventListener("change", () => {
    updateVoiceStyle(voiceStyleSelect.value as VoiceStyle);
    settingsSuccess.textContent = "Voice style updated";
    settingsError.textContent = "";
  });

  voiceSpeedSlider.value = prefs.voiceSpeed.toString();
  voiceSpeedValue.textContent = prefs.voiceSpeed.toFixed(1) + "x";
  voiceSpeedSlider.addEventListener("input", () => {
    const speed = parseFloat(voiceSpeedSlider.value);
    updateVoiceSpeed(speed);
    voiceSpeedValue.textContent = speed.toFixed(1) + "x";
  });

  // Animation & Font settings
  animationSegmented.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    const level = btn.dataset.animationLevel as AnimationLevel;
    btn.classList.toggle("active", level === prefs.animationLevel);
    btn.addEventListener("click", () => {
      animationSegmented.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      updateAnimationLevel(level);
      settingsSuccess.textContent = "Animation level updated";
      settingsError.textContent = "";
    });
  });

  fontFamilySelect.value = prefs.fontFamily;
  fontFamilySelect.addEventListener("change", () => {
    updateFontFamily(fontFamilySelect.value as FontFamily);
    settingsSuccess.textContent = "Font updated";
    settingsError.textContent = "";
  });

  fontSizeSlider.value = prefs.fontSize.toString();
  fontSizeValue.textContent = prefs.fontSize + "px";
  fontSizeSlider.addEventListener("input", () => {
    const size = parseInt(fontSizeSlider.value);
    updateFontSize(size);
    fontSizeValue.textContent = size + "px";
  });

  // Data & Memory buttons
  generateMemoryBtn.addEventListener("click", async () => {
    generateMemoryBtn.disabled = true;
    try {
      settingsSuccess.textContent = "Memory generation feature coming soon";
      settingsError.textContent = "";
    } finally {
      generateMemoryBtn.disabled = false;
    }
  });

  exportDataBtn.addEventListener("click", async () => {
    exportDataBtn.disabled = true;
    try {
      const data = {
        user: currentUser,
        preferences: getPreferences(),
        exportedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `paul-data-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      settingsSuccess.textContent = "Data exported successfully";
      settingsError.textContent = "";
    } catch (err) {
      settingsError.textContent = "Failed to export data";
    } finally {
      exportDataBtn.disabled = false;
    }
  });

  manageUploadsBtn.addEventListener("click", () => {
    settingsSuccess.textContent = "Upload management feature coming soon";
    settingsError.textContent = "";
  });

  copyUserIdBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(profileUserId.textContent || "");
      const original = copyUserIdBtn.textContent;
      copyUserIdBtn.textContent = t("common.copied");
      setTimeout(() => (copyUserIdBtn.textContent = original), 1200);
    } catch {
      // Clipboard access can fail (unsupported/insecure context) — not worth surfacing an error for.
    }
  });

  // Theme applies (and saves) the moment it's clicked — no separate save step.
  themeSegmented.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const theme = btn.dataset.themeOption as Theme;
      themeSegmented.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setTheme(theme);
      settingsError.textContent = "";
      try {
        const { user } = await api.updateSettings({ theme });
        currentUser = user;
        onUserUpdated(user);
        settingsSuccess.textContent = t("settings.themeUpdated");
      } catch (err) {
        settingsError.textContent = err instanceof ApiError ? err.message : t("settings.themeError");
      }
    });
  });

  setPasswordBtn.addEventListener("click", async () => {
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    if (passwordInput.value.length < 8) {
      settingsError.textContent = t("settings.passwordTooShort");
      return;
    }
    setPasswordBtn.disabled = true;
    try {
      const { user } = await api.updateSettings({ password: passwordInput.value });
      currentUser = user;
      onUserUpdated(user);
      passwordInput.value = "";
      settingsSuccess.textContent = t("settings.passwordUpdated");
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.passwordError");
    } finally {
      setPasswordBtn.disabled = false;
    }
  });

  googleLinkBtn.href = api.googleLinkUrl();

  googleUnlinkBtn.addEventListener("click", async () => {
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    googleUnlinkBtn.disabled = true;
    try {
      const { user } = await api.unlinkGoogle();
      renderGoogleLinkState(user);
      onUserUpdated(user);
      settingsSuccess.textContent = t("settings.googleDisconnected");
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.googleDisconnectError");
    } finally {
      googleUnlinkBtn.disabled = false;
    }
  });

  deleteAllChatsBtn.addEventListener("click", async () => {
    if (!confirm(t("settings.deleteAllChatsConfirm"))) return;
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    deleteAllChatsBtn.disabled = true;
    try {
      const { conversations } = await api.listConversations();
      await Promise.all(conversations.map((c) => api.deleteConversation(c.id)));
      await refreshConversations();
      settingsSuccess.textContent = t("settings.allChatsDeleted");
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.deleteAllChatsError");
    } finally {
      deleteAllChatsBtn.disabled = false;
    }
  });

  avatarUploadBtn.addEventListener("click", () => avatarFileInput.click());

  avatarFileInput.addEventListener("change", async () => {
    const file = avatarFileInput.files?.[0];
    avatarFileInput.value = "";
    if (!file) return;
    settingsError.textContent = "";
    try {
      const originalUrl = await readFileAsDataUrl(file);
      const croppedUrl = await showCropper(originalUrl, 1);
      if (croppedUrl) {
        pendingAvatar = croppedUrl;
        applyAvatar(editProfileAvatar, { username: currentUser?.username || "?", avatar: croppedUrl });
        avatarRemoveBtn.style.display = "inline";
      }
    } catch {
      settingsError.textContent = t("settings.avatarReadError");
    }
  });

  avatarRemoveBtn.addEventListener("click", () => {
    pendingAvatar = null;
    applyAvatar(editProfileAvatar, { username: currentUser?.username || "?", avatar: null });
    avatarRemoveBtn.style.display = "none";
  });

  saveProfileBtn.addEventListener("click", async () => {
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    const username = usernameInput.value.trim();
    if (username.length < 3 || username.length > 32) {
      settingsError.textContent = t("settings.usernameLengthError");
      return;
    }
    saveProfileBtn.disabled = true;
    try {
      const { user } = await api.updateSettings({
        username,
        display_name: displayNameInput.value.trim(),
        ...(pendingAvatar !== undefined ? { avatar: pendingAvatar } : {}),
      });
      currentUser = user;
      onUserUpdated(user);
      renderProfile(user);
      settingsSuccess.textContent = t("settings.profileUpdated");
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.profileError");
    } finally {
      saveProfileBtn.disabled = false;
    }
  });
}

export function openSettings(user: User, message?: string) {
  currentUser = user;
  themeSegmented.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeOption === user.theme);
  });
  passwordInput.value = "";
  settingsError.textContent = "";
  settingsSuccess.textContent = message || "";
  renderGoogleLinkState(user);
  renderProfile(user);
  showTab("profile");
  overlay.style.display = "flex";
}
