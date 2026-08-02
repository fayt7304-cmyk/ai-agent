import { api, ApiError, type User } from "./api";
import { setTheme, type Theme } from "./theme";
import { setLang, getStoredLang, type Lang } from "./lib/i18n";
import { refreshConversations } from "./chat-view";
import { applyAvatar } from "./lib/avatar";
import { readImageAsAvatarDataUrl } from "./files";

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
    googleLinkStatus.textContent = "Connected";
    googleLinkBtn.style.display = "none";
    googleUnlinkBtn.style.display = "inline";
  } else {
    googleLinkStatus.textContent = "Not connected";
    googleLinkBtn.style.display = "inline";
    googleUnlinkBtn.style.display = "none";
  }
}

function renderProfile(user: User) {
  applyAvatar(navProfileAvatar, user);
  navProfileUsername.textContent = user.username;
  navProfileEmail.textContent = user.email || "No email on file";
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

  copyUserIdBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(profileUserId.textContent || "");
      const original = copyUserIdBtn.textContent;
      copyUserIdBtn.textContent = "Copied!";
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
        settingsSuccess.textContent = "Theme updated.";
      } catch (err) {
        settingsError.textContent = err instanceof ApiError ? err.message : "Could not save theme.";
      }
    });
  });

  setPasswordBtn.addEventListener("click", async () => {
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    if (passwordInput.value.length < 8) {
      settingsError.textContent = "Password must be at least 8 characters.";
      return;
    }
    setPasswordBtn.disabled = true;
    try {
      const { user } = await api.updateSettings({ password: passwordInput.value });
      currentUser = user;
      onUserUpdated(user);
      passwordInput.value = "";
      settingsSuccess.textContent = "Password updated.";
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : "Could not update password.";
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
      settingsSuccess.textContent = "Google account disconnected.";
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : "Could not disconnect Google.";
    } finally {
      googleUnlinkBtn.disabled = false;
    }
  });

  deleteAllChatsBtn.addEventListener("click", async () => {
    if (!confirm("Delete all of your chats? This can't be undone.")) return;
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    deleteAllChatsBtn.disabled = true;
    try {
      const { conversations } = await api.listConversations();
      await Promise.all(conversations.map((c) => api.deleteConversation(c.id)));
      await refreshConversations();
      settingsSuccess.textContent = "All chats deleted.";
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : "Could not delete all chats.";
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
      const dataUrl = await readImageAsAvatarDataUrl(file);
      pendingAvatar = dataUrl;
      applyAvatar(editProfileAvatar, { username: currentUser?.username || "?", avatar: dataUrl });
      avatarRemoveBtn.style.display = "inline";
    } catch {
      settingsError.textContent = "Could not read that image. Please try a different photo.";
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
      settingsError.textContent = "Username must be 3-32 characters.";
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
      settingsSuccess.textContent = "Profile updated.";
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : "Could not update profile.";
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
