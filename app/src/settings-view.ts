import { api, ApiError, type User, type MemoryEntry } from "./api";
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

// ---- Memory tab -----------------------------------------------------------
// Paul's cross-chat memory: the switch, the list of what he remembers, and a way
// to add or remove entries by hand.
const memoryEnabledToggle = document.getElementById("memory-enabled-toggle") as HTMLInputElement;
const memoryList = document.getElementById("memory-list") as HTMLDivElement;
const memoryAddForm = document.getElementById("memory-add-form") as HTMLFormElement;
const memoryInput = document.getElementById("memory-input") as HTMLInputElement;
const memoryBrowser = document.getElementById("memory-browser") as HTMLDivElement;
const memoryDetail = document.getElementById("memory-detail") as HTMLDivElement;
const memoryDetailBack = document.getElementById("memory-detail-back") as HTMLButtonElement;
const memoryDetailTitle = document.getElementById("memory-detail-title") as HTMLDivElement;
const memoryDetailMeta = document.getElementById("memory-detail-meta") as HTMLDivElement;
const memoryDetailBody = document.getElementById("memory-detail-body") as HTMLUListElement;
const memoryDetailDelete = document.getElementById("memory-detail-delete") as HTMLButtonElement;
const memoryDetailEdit = document.getElementById("memory-detail-edit") as HTMLButtonElement;
const memoryExportBtn = document.getElementById("memory-export-btn") as HTMLButtonElement;
const memoryImportBtn = document.getElementById("memory-import-btn") as HTMLButtonElement;
const memoryImportFile = document.getElementById("memory-import-file") as HTMLInputElement;
const memoryEditMode = document.getElementById("memory-edit-mode") as HTMLDivElement;
const memoryEditForm = document.getElementById("memory-edit-form") as HTMLFormElement;
const memoryEditTitle = document.getElementById("memory-edit-title") as HTMLInputElement;
const memoryEditContent = document.getElementById("memory-edit-content") as HTMLTextAreaElement;
const memoryEditBack = document.getElementById("memory-edit-back") as HTMLButtonElement;
const memoryEditCancel = document.getElementById("memory-edit-cancel") as HTMLButtonElement;

let openMemoryId: string | null = null;
let allMemories: MemoryEntry[] = [];

function formatMemoryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Split a stored entry into readable bullets, the way the detail view shows them. */
function memoryBullets(content: string): string[] {
  const lines = content
    .split(/\n+|(?<=[.;])\s+(?=[A-Z0-9])/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  return lines.length ? lines : [content];
}

function showMemoryList() {
  openMemoryId = null;
  memoryDetail.style.display = "none";
  memoryBrowser.style.display = "";
}

function showMemoryDetail(entry: MemoryEntry) {
  openMemoryId = entry.id;
  memoryDetailTitle.textContent = entry.title;
  memoryDetailMeta.textContent = `${t("settings.memoryUpdated")} ${formatMemoryDate(entry.updated_at)}`;
  memoryDetailBody.innerHTML = "";
  for (const line of memoryBullets(entry.content)) {
    const li = document.createElement("li");
    li.textContent = line;
    memoryDetailBody.appendChild(li);
  }
  memoryBrowser.style.display = "none";
  memoryDetail.style.display = "";
}

function renderMemories(memories: MemoryEntry[]) {
  if (openMemoryId) {
    const still = memories.find((m) => m.id === openMemoryId);
    if (still) showMemoryDetail(still);
    else showMemoryList();
  }
  if (!memories.length) {
    memoryList.innerHTML = `<div class="memory-empty">${t("settings.memoryEmpty")}</div>`;
    return;
  }
  memoryList.innerHTML = memories
    .map(
      (m) => `<button type="button" class="memory-item" data-memory-id="${m.id}">
        <span class="memory-item-main">
          <span class="memory-item-title"></span>
          <span class="memory-item-content"></span>
        </span>
        <span class="memory-item-meta">${t("settings.memoryUpdated")} ${formatMemoryDate(m.updated_at)}</span>
        <span class="memory-item-caret" aria-hidden="true">›</span>
      </button>`
    )
    .join("");
  // Titles/contents are user + model text, so they go in via textContent.
  memoryList.querySelectorAll<HTMLElement>(".memory-item").forEach((el, i) => {
    el.querySelector<HTMLElement>(".memory-item-title")!.textContent = memories[i].title;
    el.querySelector<HTMLElement>(".memory-item-content")!.textContent = memories[i].content;
    el.addEventListener("click", () => showMemoryDetail(memories[i]));
  });
}

memoryDetailBack.addEventListener("click", showMemoryList);

memoryDetailEdit.addEventListener("click", () => {
  if (!openMemoryId) return;
  const entry = allMemories.find((m) => m.id === openMemoryId);
  if (!entry) return;
  memoryEditTitle.value = entry.title;
  memoryEditContent.value = entry.content;
  memoryBrowser.style.display = "none";
  memoryDetail.style.display = "none";
  memoryEditMode.style.display = "";
});

memoryEditBack.addEventListener("click", () => {
  if (openMemoryId) {
    const entry = allMemories.find((m) => m.id === openMemoryId);
    if (entry) showMemoryDetail(entry);
  }
});

memoryEditCancel.addEventListener("click", () => {
  if (openMemoryId) {
    const entry = allMemories.find((m) => m.id === openMemoryId);
    if (entry) showMemoryDetail(entry);
  }
});

memoryEditForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!openMemoryId) return;
  const newTitle = memoryEditTitle.value.trim();
  const newContent = memoryEditContent.value.trim();
  if (!newTitle || !newContent) {
    settingsError.textContent = t("settings.memoryEmptyTitle");
    return;
  }
  const submitBtn = memoryEditForm.querySelector("button[type='submit']") as HTMLButtonElement;
  submitBtn.disabled = true;
  try {
    const { memories: next } = await api.addMemory(newContent, newTitle);
    allMemories = next;
    renderMemories(next);
    settingsSuccess.textContent = t("settings.memorySaved");
    setTimeout(() => { settingsSuccess.textContent = ""; }, 3000);
    const entry = next.find((m) => m.id === openMemoryId);
    if (entry) showMemoryDetail(entry);
  } catch (err) {
    settingsError.textContent = err instanceof ApiError ? err.message : t("settings.memoryNotAvailable");
  } finally {
    submitBtn.disabled = false;
  }
});

memoryDetailDelete.addEventListener("click", async () => {
  if (!openMemoryId) return;
  memoryDetailDelete.disabled = true;
  try {
    const { memories: next } = await api.deleteMemory(openMemoryId);
    allMemories = next;
    showMemoryList();
    renderMemories(next);
  } catch (err) {
    settingsError.textContent = err instanceof ApiError ? err.message : t("settings.memoryNotAvailable");
  } finally {
    memoryDetailDelete.disabled = false;
  }
});

memoryExportBtn.addEventListener("click", () => {
  const content = allMemories
    .map((m) => `[${m.title}]\n${m.content}\n`)
    .join("\n---\n\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `paul-memory-${new Date().toISOString().split("T")[0]}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

memoryImportBtn.addEventListener("click", () => {
  memoryImportFile.click();
});

memoryImportFile.addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  const entries = text.split(/\n---\n\n/).filter(Boolean);
  memoryImportBtn.disabled = true;
  let added = 0;
  for (const entry of entries) {
    const lines = entry.trim().split("\n");
    const titleMatch = lines[0].match(/\[(.*?)\]/);
    const title = titleMatch ? titleMatch[1] : "Imported";
    const content = lines.slice(titleMatch ? 1 : 0).join("\n").trim();
    if (content) {
      try {
        const { memories: next } = await api.addMemory(content, title);
        allMemories = next;
        added++;
      } catch (err) {
        console.error("Failed to import entry:", err);
      }
    }
  }
  renderMemories(allMemories);
  settingsSuccess.textContent = t("settings.memoryImported").replace("{n}", String(added));
  setTimeout(() => { settingsSuccess.textContent = ""; }, 3000);
  memoryImportBtn.disabled = false;
  memoryImportFile.value = "";
});

async function loadMemory() {
  showMemoryList();
  memoryList.innerHTML = `<div class="memory-empty">${t("settings.memoryLoading")}</div>`;
  try {
    const { enabled, memories } = await api.listMemory();
    allMemories = memories;
    memoryEnabledToggle.checked = enabled;
    renderMemories(memories);
  } catch (err) {
    // Keep the empty state visible rather than an empty box when the list can't load.
    renderMemories([]);
    settingsError.textContent = err instanceof ApiError ? err.message : t("settings.memoryNotAvailable");
  }
}


function renderGoogleLinkState(user: User) {
  googleLinkBtn.href = api.googleLinkUrl();
  if (user.google_linked) {
    googleLinkStatus.textContent = t("settings.connected");
    googleLinkBtn.style.display = "none";
    googleUnlinkBtn.style.display = "inline-flex";
  } else {
    googleLinkStatus.textContent = t("settings.notConnected");
    googleLinkBtn.style.display = "inline-flex";
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
  memory: "memory",
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
  if (tab === "memory") void loadMemory();
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
      if (tab === "memory") void loadMemory();
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
    settingsError.textContent = "";
    settingsSuccess.textContent = "";

    if (!on) {
      // Turning off: update immediately, no probe needed.
      syncHqVoice(false);
      updateHighQualityVoice(false);
      settingsSuccess.textContent = t("settings.hqVoice") + " " + t("settings.updated");
      return;
    }

    // Turning on: probe the server FIRST — only enable if it actually responds.
    // Show a busy state while waiting so the user knows something is happening.
    hqVoiceToggle.setAttribute("aria-busy", "true");
    hqVoiceToggle.disabled = true;
    settingsSuccess.textContent = t("settings.hqVoice") + "…";

    const status = await checkHighQualityVoice();

    hqVoiceToggle.removeAttribute("aria-busy");
    hqVoiceToggle.disabled = false;

    if (status.ok) {
      // Probe succeeded — now enable and persist.
      syncHqVoice(true);
      updateHighQualityVoice(true);
      settingsSuccess.textContent = t("settings.hqVoiceReady");
    } else {
      // Probe failed — keep toggle off, explain why.
      syncHqVoice(false);
      updateHighQualityVoice(false);
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

  memoryEnabledToggle.addEventListener("change", async () => {
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    try {
      await api.setMemoryEnabled(memoryEnabledToggle.checked);
      settingsSuccess.textContent = t("settings.memorySaved");
    } catch (err) {
      memoryEnabledToggle.checked = !memoryEnabledToggle.checked;
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.memoryNotAvailable");
    }
  });

  memoryAddForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const content = memoryInput.value.trim();
    if (!content) return;
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    try {
      const { memories } = await api.addMemory(content);
      memoryInput.value = "";
      renderMemories(memories);
      settingsSuccess.textContent = t("settings.memorySaved");
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.memoryNotAvailable");
    }
  });

  // "Generate memory from chats" became "Update from chats": instead of
  // downloading a .txt nobody could use, it now re-reads recent chats and stores
  // structured entries Paul actually reuses in every new conversation.
  generateMemoryBtn.addEventListener("click", async () => {
    generateMemoryBtn.disabled = true;
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    try {
      const { memories } = await api.refreshMemory();
      renderMemories(memories);
      settingsSuccess.textContent = t("settings.memoryGenerated");
    } catch (err) {
      settingsError.textContent =
        err instanceof ApiError && err.status !== 404 ? err.message : t("settings.memoryNotAvailable");
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

  // "Connect Google" was rendered as <a href="#"> and never wired up, so it did
  // nothing at all. Send the browser to the Worker's OAuth start endpoint (with
  // the session token attached, see api.googleLinkUrl) on click.
  googleLinkBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    settingsError.textContent = "";
    settingsSuccess.textContent = "";
    googleLinkBtn.classList.add("is-busy");
    try {
      // Refresh the session first: the redirect carries the token in the URL, and
      // on a cookie-only session there was no token to carry — the Worker then
      // bounced straight back with link_error=not_authenticated, which looked
      // exactly like "the button does nothing".
      await api.me();
      window.location.assign(api.googleLinkUrl());
    } catch {
      googleLinkBtn.classList.remove("is-busy");
      settingsError.textContent = t("settings.googleLinkError");
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
