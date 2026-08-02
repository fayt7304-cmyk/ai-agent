import { api, ApiError, type User } from "./api";
import { setTheme, type Theme } from "./theme";
import { refreshConversations } from "./chat-view";

const overlay = document.getElementById("settings-overlay") as HTMLDivElement;
const closeBtn = document.getElementById("settings-close-btn") as HTMLButtonElement;
const cancelBtn = document.getElementById("settings-cancel-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("settings-save-btn") as HTMLButtonElement;
const themeSegmented = document.getElementById("theme-segmented") as HTMLDivElement;
const passwordInput = document.getElementById("new-password-input") as HTMLInputElement;
const settingsError = document.getElementById("settings-error") as HTMLDivElement;
const settingsSuccess = document.getElementById("settings-success") as HTMLDivElement;
const googleLinkStatus = document.getElementById("google-link-status") as HTMLSpanElement;
const googleLinkBtn = document.getElementById("google-link-btn") as HTMLAnchorElement;
const googleUnlinkBtn = document.getElementById("google-unlink-btn") as HTMLButtonElement;

const settingsNav = document.getElementById("settings-nav") as HTMLDivElement;
const settingsPanels = document.querySelectorAll<HTMLElement>(".settings-panel");

const profileAvatar = document.getElementById("profile-avatar") as HTMLDivElement;
const profileUsername = document.getElementById("profile-username") as HTMLDivElement;
const profileEmail = document.getElementById("profile-email") as HTMLDivElement;
const profileUserId = document.getElementById("profile-user-id") as HTMLElement;
const copyUserIdBtn = document.getElementById("copy-user-id-btn") as HTMLButtonElement;
const deleteAllChatsBtn = document.getElementById("delete-all-chats-btn") as HTMLButtonElement;

let selectedTheme: Theme = "system";

function close() {
  overlay.style.display = "none";
  settingsError.textContent = "";
  settingsSuccess.textContent = "";
  passwordInput.value = "";
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
  profileAvatar.textContent = user.username.slice(0, 2).toUpperCase();
  profileUsername.textContent = user.username;
  profileEmail.textContent = user.email || "No email on file";
  profileUserId.textContent = user.id;
}

export function initSettingsView(onUserUpdated: (user: User) => void) {
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  settingsNav.querySelectorAll<HTMLButtonElement>(".settings-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.settingsTab!));
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

export function openSettings(user: User, message?: string) {
  selectedTheme = user.theme;
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
