import { api, ApiError, type User } from "./api";
import { API_BASE } from "./api";
import { setTheme, type Theme } from "./theme";
import { setLang, getStoredLang, t, type Lang } from "./lib/i18n";
import { refreshConversations } from "./chat-view";
import { applyAvatar } from "./lib/avatar";
import { readFileAsDataUrl } from "./files";
import { showCropper } from "./lib/cropper";
import { getPreferences, updateAnimationLevel, updateFontFamily, updateFontSize, updateVoiceLanguage, updateVoiceStyle, updateVoiceSpeed, updateHighQualityVoice, type AnimationLevel, type FontFamily, type VoiceLanguage, type VoiceStyle } from "./lib/preferences";
import { showConfirm } from "./lib/dialog";
import { renderFileList, downloadAllFiles, type StoredFile } from "./lib/file-downloads";

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
const uploadsList = document.getElementById("uploads-list") as HTMLDivElement;
const downloadAllUploadsBtn = document.getElementById("download-all-uploads-btn") as HTMLButtonElement;
const hqVoiceToggle = document.getElementById("hq-voice-toggle") as HTMLButtonElement;

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

/** Helper: make an authenticated request to the API base, same pattern as api.ts */
async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let data: any = null;
  try { data = await resp.json(); } catch { /* no body */ }
  if (!resp.ok) throw new ApiError(data?.error || `Request failed (${resp.status})`, resp.status);
  return data as T;
}

/**
 * Opens the settings modal.
 * Supports three call patterns:
 * 1. openSettings(tabName: string)
 * 2. openSettings(user: User)
 * 3. openSettings(user: User, message: string)
 */
/**
 * Settings collapsed from 7 tabs to 3 (General / Account / Privacy). Older call
 * sites (and the user menu) still ask for the previous tab names, so map them
 * onto the panel that now contains that section.
 */
const TAB_ALIASES: Record<string, string> = {
  profile: "general",
  preferences: "general",
  voice: "general",
  animations: "general",
  security: "account",
  sessions: "account",
  data: "privacy",
  memory: "privacy",
  uploads: "privacy",
  general: "general",
  account: "account",
  privacy: "privacy",
};

function resolveTab(tab: string): string {
  return TAB_ALIASES[tab] || "general";
}

export function openSettings(tabOrUser: string | User = "general", userOrMessage?: User | string, message?: string) {
  let tab = "general";
  let user: User | undefined;
  let msg = "";

  if (typeof tabOrUser === "string") {
    // Case 1: openSettings("voice")
    tab = tabOrUser;
    msg = typeof userOrMessage === "string" ? userOrMessage : "";
  } else {
    // Case 2 & 3: openSettings(user) or openSettings(user, "Connected!")
    user = tabOrUser;
    msg = typeof userOrMessage === "string" ? userOrMessage : "";
    tab = "general";
  }
  tab = resolveTab(tab);

  if (user) {
    currentUser = user;
    themeSegmented.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.themeOption === user!.theme);
    });
    renderGoogleLinkState(user);
    renderProfile(user);
  }
  
  passwordInput.value = "";
  settingsError.textContent = "";
  settingsSuccess.textContent = msg || message || "";
  
  overlay.style.display = "flex";
  showTab(tab);
  // The panels scroll independently; always open at the top of the chosen tab.
  document.querySelector<HTMLElement>(`.settings-panel[data-settings-panel="${tab}"]`)?.scrollTo({ top: 0 });
}

/** Copy text to the clipboard, with a fallback for browsers/contexts without the async API. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Ask the Worker whether the studio-voice proxy is actually configured. */
async function checkHighQualityVoice(): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(`${API_BASE}/api/tts`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Test." }),
    });
    if (resp.ok) {
      // Drain the body so the connection closes cleanly; we don't play this clip.
      await resp.blob().catch(() => null);
      return { ok: true, message: "" };
    }
    const data = await resp.json().catch(() => null);
    if (resp.status === 501) return { ok: false, message: t("settings.hqVoiceNotConfigured") };
    return { ok: false, message: data?.error || t("settings.hqVoiceError") };
  } catch {
    return { ok: false, message: t("settings.hqVoiceError") };
  }
}

export function initSettingsView(onUserUpdated: (user: User) => void) {
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  settingsNav.querySelectorAll<HTMLButtonElement>(".settings-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.settingsTab!;
      showTab(tab);
      if (tab === "account") loadActiveSessions();
    });
  });

  // The Copy button next to the user ID was rendered but never wired up.
  copyUserIdBtn.addEventListener("click", async () => {
    const id = profileUserId.textContent?.trim() || "";
    if (!id || id === "\u2014") return;
    const ok = await copyText(id);
    settingsError.textContent = ok ? "" : t("settings.copyFailed");
    settingsSuccess.textContent = ok ? t("settings.copied") : "";
    if (ok) {
      const original = copyUserIdBtn.textContent;
      copyUserIdBtn.textContent = t("settings.copied");
      copyUserIdBtn.disabled = true;
      setTimeout(() => {
        copyUserIdBtn.textContent = original || t("settings.copy");
        copyUserIdBtn.disabled = false;
      }, 1400);
    }
  });

  // The theme buttons rendered an "active" state but had no click handler, so
  // choosing a theme in Settings did nothing at all. Wire them to setTheme().
  themeSegmented.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const theme = btn.dataset.themeOption as Theme;
      if (!theme) return;
      themeSegmented.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setTheme(theme);
      settingsError.textContent = "";
      settingsSuccess.textContent = t("settings.theme") + " " + t("settings.updated");
      // Persist to the account so the choice follows the user to other devices.
      try {
        const { user } = await api.updateSettings({ theme });
        currentUser = user;
        onUserUpdated(user);
      } catch {
        // Theme is already applied locally; a failed sync isn't worth an error.
      }
    });
  });

  languageSelect.value = getStoredLang();
  languageSelect.addEventListener("change", () => {
    setLang(languageSelect.value as Lang);
  });

  const prefs = getPreferences();
  voiceLanguageSelect.value = prefs.voiceLanguage;
  voiceLanguageSelect.addEventListener("change", () => {
    updateVoiceLanguage(voiceLanguageSelect.value as VoiceLanguage);
    settingsSuccess.textContent = t("settings.voiceLanguage") + " " + t("settings.updated");
    settingsError.textContent = "";
  });

  voiceStyleSelect.value = prefs.voiceStyle;
  voiceStyleSelect.addEventListener("change", () => {
    updateVoiceStyle(voiceStyleSelect.value as VoiceStyle);
    settingsSuccess.textContent = t("settings.voiceStyle") + " " + t("settings.updated");
    settingsError.textContent = "";
  });

  voiceSpeedSlider.value = prefs.voiceSpeed.toString();
  voiceSpeedValue.textContent = prefs.voiceSpeed.toFixed(1) + "x";
  voiceSpeedSlider.addEventListener("input", () => {
    const speed = parseFloat(voiceSpeedSlider.value);
    updateVoiceSpeed(speed);
    voiceSpeedValue.textContent = speed.toFixed(1) + "x";
    settingsSuccess.textContent = t("settings.voiceSpeed") + " " + t("settings.updated");
    settingsError.textContent = "";
  });

  const syncHqVoice = (on: boolean) => {
    hqVoiceToggle.classList.toggle("on", on);
    hqVoiceToggle.setAttribute("aria-checked", on ? "true" : "false");
  };
  syncHqVoice(prefs.highQualityVoice);
  hqVoiceToggle.addEventListener("click", async () => {
    const on = !hqVoiceToggle.classList.contains("on");
    syncHqVoice(on);
    updateHighQualityVoice(on);
    settingsError.textContent = "";
    settingsSuccess.textContent = t("settings.hqVoice") + " " + t("settings.updated");
    if (!on) return;
    // Turning it on used to fail silently: if the server has no voice key the
    // app just kept using the device voice with no explanation. Probe the proxy
    // once and say exactly what happened.
    hqVoiceToggle.setAttribute("aria-busy", "true");
    const status = await checkHighQualityVoice();
    hqVoiceToggle.removeAttribute("aria-busy");
    if (status.ok) {
      settingsSuccess.textContent = t("settings.hqVoiceReady");
    } else {
      settingsSuccess.textContent = "";
      settingsError.textContent = status.message;
    }
  });

  animationSegmented.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    const level = btn.dataset.animationLevel as AnimationLevel;
    btn.classList.toggle("active", level === prefs.animationLevel);
    btn.addEventListener("click", () => {
      animationSegmented.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      updateAnimationLevel(level);
      settingsSuccess.textContent = t("settings.animationLevel") + " " + t("settings.updated");
      settingsError.textContent = "";
    });
  });

  fontFamilySelect.value = prefs.fontFamily;
  fontFamilySelect.addEventListener("change", () => {
    updateFontFamily(fontFamilySelect.value as FontFamily);
    settingsSuccess.textContent = t("settings.fontFamily") + " " + t("settings.updated");
    settingsError.textContent = "";
  });

  fontSizeSlider.value = prefs.fontSize.toString();
  fontSizeValue.textContent = prefs.fontSize + "px";
  fontSizeSlider.addEventListener("input", () => {
    const size = parseInt(fontSizeSlider.value);
    updateFontSize(size);
    fontSizeValue.textContent = size + "px";
    settingsSuccess.textContent = t("settings.fontSize") + " " + t("settings.updated");
    settingsError.textContent = "";
  });

  generateMemoryBtn.addEventListener("click", async () => {
    generateMemoryBtn.disabled = true;
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    try {
      // Fetch the memory file as a blob and download it
      const resp = await fetch(`${API_BASE}/api/memory/generate`, {
        method: "POST",
        credentials: "include",
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new ApiError(data?.error || `Request failed (${resp.status})`, resp.status);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `memory-profile-${new Date().toISOString().split("T")[0]}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      settingsSuccess.textContent = t("settings.memoryGenerated");
    } catch (err) {
      settingsError.textContent = err instanceof ApiError && err.status !== 404
        ? err.message
        : t("settings.memoryNotAvailable");
    } finally {
      generateMemoryBtn.disabled = false;
    }
  });

  exportDataBtn.addEventListener("click", async () => {
    exportDataBtn.disabled = true;
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    try {
      const { conversations } = await api.listConversations();
      const exportObj = {
        exported_at: new Date().toISOString(),
        conversations,
      };
      const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `data-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      settingsSuccess.textContent = t("settings.dataExported");
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.dataExportError");
    } finally {
      exportDataBtn.disabled = false;
    }
  });

  let loadedUploads: StoredFile[] = [];

  manageUploadsBtn.addEventListener("click", async () => {
    manageUploadsBtn.disabled = true;
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    try {
      const data = await apiRequest<{ uploads?: StoredFile[]; files?: StoredFile[]; count?: number }>("/api/uploads", { method: "GET" });
      loadedUploads = data.uploads || data.files || [];
      const count = data.count ?? loadedUploads.length;
      renderFileList(uploadsList, loadedUploads);
      downloadAllUploadsBtn.style.display = loadedUploads.some((f) => f.dataUrl) ? "inline-flex" : "none";
      settingsSuccess.textContent = t("settings.uploadsCount").replace("{n}", String(count));
    } catch (err) {
      settingsError.textContent = err instanceof ApiError && err.status !== 404
        ? err.message
        : t("settings.uploadsNotAvailable");
    } finally {
      manageUploadsBtn.disabled = false;
    }
  });

  downloadAllUploadsBtn.addEventListener("click", () => downloadAllFiles(loadedUploads));

  const activeSessionsList = document.getElementById("active-sessions-list") as HTMLDivElement;
  const deleteAccountBtn = document.getElementById("delete-account-btn") as HTMLButtonElement;

  async function loadActiveSessions() {
    activeSessionsList.innerHTML = `<p style='padding: 12px; color: var(--text-secondary); font-size: 13px;'>${t("settings.loadingSessions")}</p>`;
    try {
      const data = await apiRequest<any[]>("/api/sessions", { method: "GET" });
      const sessions: any[] = Array.isArray(data) ? data : [];
      activeSessionsList.innerHTML = "";
      if (sessions.length === 0) {
        activeSessionsList.innerHTML = `<p style='padding: 12px; color: var(--text-secondary); font-size: 13px;'>${t("settings.noActiveSessions")}</p>`;
      } else {
        sessions.forEach((session: any) => {
          const sessionEl = document.createElement("div");
          sessionEl.className = "session-item";
          sessionEl.style.cssText = "padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 12px;";
          const revokeBtn = document.createElement("button");
          revokeBtn.textContent = t("settings.revokeSession");
          revokeBtn.className = "danger-btn";
          revokeBtn.style.cssText = "padding: 5px 12px; font-size: 12px; flex-shrink: 0;";
          revokeBtn.onclick = async () => {
            revokeBtn.disabled = true;
            try {
              await apiRequest(`/api/sessions/${session.id}`, { method: "DELETE" });
              loadActiveSessions();
            } catch {
              revokeBtn.disabled = false;
            }
          };
          const info = document.createElement("div");
          info.innerHTML = `
            <div style='font-weight: 500; font-size: 13px;'>${session.device || t("settings.unknownDevice")}</div>
            <div style='font-size: 12px; color: var(--text-secondary); margin-top: 2px;'>${new Date(session.created_at).toLocaleString()}</div>
          `;
          sessionEl.appendChild(info);
          sessionEl.appendChild(revokeBtn);
          activeSessionsList.appendChild(sessionEl);
        });
      }
    } catch (err) {
      const msg = err instanceof ApiError && err.status !== 404
        ? err.message
        : t("settings.sessionsNotAvailable");
      activeSessionsList.innerHTML = `<p style='padding: 12px; color: var(--text-secondary); font-size: 13px;'>${msg}</p>`;
    }
  }
  loadActiveSessions();

  deleteAccountBtn.addEventListener("click", async () => {
    const ok = await showConfirm({
      title: t("settings.deleteAccount"),
      message: t("settings.deleteAccountConfirm"),
      confirmLabel: t("settings.deleteAccount"),
      danger: true,
    });
    if (!ok) return;
    deleteAccountBtn.disabled = true;
    try {
      await apiRequest("/api/user/delete", { method: "DELETE" });
      window.location.reload();
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.deleteAccountError");
      deleteAccountBtn.disabled = false;
    }
  });

  setPasswordBtn.addEventListener("click", async () => {
    const password = passwordInput.value.trim();
    if (password.length < 8) {
      settingsError.textContent = t("auth.signupHint");
      return;
    }
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    setPasswordBtn.disabled = true;
    try {
      await api.updateSettings({ password });
      settingsSuccess.textContent = t("settings.passwordUpdated");
      passwordInput.value = "";
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.passwordError");
    } finally {
      setPasswordBtn.disabled = false;
    }
  });

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
    const ok = await showConfirm({
      title: t("settings.deleteAllChats"),
      message: t("settings.deleteAllChatsConfirm"),
      confirmLabel: t("settings.deleteAllChats"),
      danger: true,
    });
    if (!ok) return;
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
