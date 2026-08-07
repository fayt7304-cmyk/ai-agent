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
import { icons } from "./lib/icons";

const overlay = document.getElementById("settings-overlay") as HTMLDivElement;
const closeBtn = document.getElementById("settings-close-btn") as HTMLButtonElement;
const themeSegmented = document.getElementById("theme-segmented") as HTMLDivElement;
const languageSelect = document.getElementById("language-select") as HTMLSelectElement;

// Claude-style appearance icons in General → Appearance (after themeSegmented exists)
(() => {
  const map: Record<string, string> = {
    system: icons.monitor,
    light: icons.sun,
    dark: icons.moon,
  };
  themeSegmented?.querySelectorAll<HTMLButtonElement>("button[data-theme-option]").forEach((btn) => {
    const key = btn.dataset.themeOption || "";
    if (map[key]) btn.innerHTML = map[key];
  });
})();
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
const memoryDetailSummary = document.getElementById("memory-detail-summary") as HTMLDivElement;
const memoryViewMode = document.getElementById("memory-view-mode") as HTMLDivElement;
const memoryEditForm = document.getElementById("memory-edit-form") as HTMLFormElement;
const memoryEditTitle = document.getElementById("memory-edit-title") as HTMLInputElement;
const memoryEditContent = document.getElementById("memory-edit-content") as HTMLTextAreaElement;
const memoryEditCancel = document.getElementById("memory-edit-cancel") as HTMLButtonElement;
const memoryEditSave = document.getElementById("memory-edit-save") as HTMLButtonElement;
const memoryExportBtn = document.getElementById("memory-export-btn") as HTMLButtonElement;
const memoryImportBtn = document.getElementById("memory-import-btn") as HTMLButtonElement;
const memoryImportFile = document.getElementById("memory-import-file") as HTMLInputElement;
const memoryTalkForm = document.getElementById("memory-talk-form") as HTMLFormElement;
const memoryTalkInput = document.getElementById("memory-talk-input") as HTMLInputElement;
const memoryTalkSend = document.getElementById("memory-talk-send") as HTMLButtonElement;

let openMemoryId: string | null = null;
let allMemories: MemoryEntry[] = [];
let memoryEditing = false;

function formatMemoryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Split a stored entry into readable bullets, the way the detail view shows them. */
function memoryBullets(content: string): string[] {
  const lines = content
    .split(/\n+|(?<=[.;])\s+(?=[A-Z0-9\u0600-\u06FF\u4e00-\u9fff])/)
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  return lines.length ? lines : [content];
}

/** Short one-line summary for the Claude-style detail header. */
function memorySummary(entry: MemoryEntry): string {
  const first = memoryBullets(entry.content)[0] || entry.content;
  return first.length > 140 ? first.slice(0, 137) + "…" : first;
}

function exitMemoryEdit() {
  memoryEditing = false;
  if (memoryEditForm) memoryEditForm.style.display = "none";
  if (memoryViewMode) memoryViewMode.style.display = "";
  if (memoryDetailEdit) memoryDetailEdit.style.display = "";
}

function showMemoryList() {
  openMemoryId = null;
  exitMemoryEdit();
  memoryDetail.style.display = "none";
  memoryBrowser.style.display = "";
}

function showMemoryDetail(entry: MemoryEntry) {
  openMemoryId = entry.id;
  exitMemoryEdit();
  memoryDetailTitle.textContent = entry.title;
  memoryDetailMeta.textContent = `${t("settings.memoryUpdated")} ${formatMemoryDate(entry.updated_at)}`;
  memoryDetailSummary.textContent = memorySummary(entry);
  memoryDetailBody.innerHTML = "";
  for (const line of memoryBullets(entry.content)) {
    const li = document.createElement("li");
    li.textContent = line;
    memoryDetailBody.appendChild(li);
  }
  memoryTalkInput.value = "";
  memoryBrowser.style.display = "none";
  memoryDetail.style.display = "";
}

function enterMemoryEdit() {
  if (!openMemoryId) return;
  const entry = allMemories.find((m) => m.id === openMemoryId);
  if (!entry) return;
  memoryEditing = true;
  memoryEditTitle.value = entry.title;
  memoryEditContent.value = entry.content;
  memoryViewMode.style.display = "none";
  memoryEditForm.style.display = "";
  memoryDetailEdit.style.display = "none";
  memoryEditTitle.focus();
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

memoryDetailEdit?.addEventListener("click", () => enterMemoryEdit());

memoryEditCancel?.addEventListener("click", () => {
  exitMemoryEdit();
  if (openMemoryId) {
    const entry = allMemories.find((m) => m.id === openMemoryId);
    if (entry) showMemoryDetail(entry);
  }
});

memoryEditForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!openMemoryId) return;
  const title = memoryEditTitle.value.trim();
  const content = memoryEditContent.value.trim();
  if (!title && !content) {
    settingsError.textContent = t("settings.memoryEmptyTitle");
    return;
  }
  memoryEditSave.disabled = true;
  settingsError.textContent = "";
  try {
    const { memories: next } = await api.updateMemory(openMemoryId, title, content);
    allMemories = next;
    settingsSuccess.textContent = t("settings.memorySaved");
    setTimeout(() => {
      settingsSuccess.textContent = "";
    }, 3000);
    const updated = next.find((m) => m.id === openMemoryId);
    if (updated) showMemoryDetail(updated);
    else {
      showMemoryList();
      renderMemories(next);
    }
  } catch (err) {
    settingsError.textContent = err instanceof ApiError ? err.message : t("settings.memoryNotAvailable");
  } finally {
    memoryEditSave.disabled = false;
  }
});

/** Ask Paul to revise the open memory from a natural-language instruction. */
memoryTalkForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!openMemoryId) return;
  const instruction = memoryTalkInput.value.trim();
  if (!instruction) return;

  const entry = allMemories.find((m) => m.id === openMemoryId);
  if (!entry) return;

  memoryTalkSend.disabled = true;
  memoryTalkInput.disabled = true;
  settingsError.textContent = "";
  settingsSuccess.textContent = t("settings.memoryTalking");

  try {
    const { memories: next, deleted } = await api.reviseMemory(openMemoryId, instruction);
    allMemories = next;
    memoryTalkInput.value = "";
    settingsSuccess.textContent = t("settings.memorySaved");
    setTimeout(() => {
      settingsSuccess.textContent = "";
    }, 3000);
    if (deleted) {
      showMemoryList();
      renderMemories(next);
    } else {
      renderMemories(next);
      const updated = next.find((m) => m.id === openMemoryId) || next.find((m) => m.title === entry.title);
      if (updated) showMemoryDetail(updated);
      else {
        showMemoryList();
        renderMemories(next);
      }
    }
  } catch (err) {
    settingsSuccess.textContent = "";
    settingsError.textContent = err instanceof ApiError ? err.message : t("settings.memoryNotAvailable");
  } finally {
    memoryTalkSend.disabled = false;
    memoryTalkInput.disabled = false;
    memoryTalkInput.focus();
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
    deletionUiSync?.(user);
  } else if (currentUser) {
    deletionUiSync?.(currentUser);
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

/** Filled in by initSettingsView so openSettings can refresh soft-delete UI. */
let deletionUiSync: ((user: User) => void) | null = null;

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
    if (resp.status === 501) return { ok: false, message: t("settings.hqVoiceNotConfigured") };
    // Never surface raw upstream JSON (Workers AI / ElevenLabs) in the settings UI.
    return { ok: false, message: t("settings.hqVoiceError") };
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

  const syncVoiceSpeedUi = (speed: number) => {
    const s = Math.max(0.5, Math.min(2, speed));
    voiceSpeedSlider.value = String(s);
    voiceSpeedValue.textContent = s.toFixed(1) + "x";
    voiceSpeedSlider.setAttribute("aria-valuenow", s.toFixed(1));
    voiceSpeedSlider.setAttribute("aria-valuetext", s.toFixed(1) + "x");
  };
  syncVoiceSpeedUi(prefs.voiceSpeed);
  voiceSpeedSlider.setAttribute("aria-label", t("settings.voiceSpeed"));
  let voiceSpeedToastTimer = 0;
  voiceSpeedSlider.addEventListener("input", () => {
    const speed = parseFloat(voiceSpeedSlider.value);
    updateVoiceSpeed(speed);
    syncVoiceSpeedUi(getPreferences().voiceSpeed);
    settingsError.textContent = "";
    window.clearTimeout(voiceSpeedToastTimer);
    voiceSpeedToastTimer = window.setTimeout(() => {
      settingsSuccess.textContent = t("settings.voiceSpeed") + " " + t("settings.updated");
    }, 280);
  });
  voiceSpeedSlider.addEventListener("change", () => {
    syncVoiceSpeedUi(getPreferences().voiceSpeed);
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

  const syncFontSizeUi = (size: number) => {
    const s = Math.max(12, Math.min(18, Math.round(size)));
    fontSizeSlider.value = String(s);
    fontSizeValue.textContent = s + "px";
    fontSizeSlider.setAttribute("aria-valuenow", String(s));
    fontSizeSlider.setAttribute("aria-valuetext", s + "px");
  };
  syncFontSizeUi(prefs.fontSize);
  fontSizeSlider.setAttribute("aria-label", t("settings.fontSize"));
  let fontSizeToastTimer = 0;
  fontSizeSlider.addEventListener("input", () => {
    const size = parseInt(fontSizeSlider.value, 10);
    updateFontSize(size);
    syncFontSizeUi(getPreferences().fontSize);
    settingsError.textContent = "";
    window.clearTimeout(fontSizeToastTimer);
    fontSizeToastTimer = window.setTimeout(() => {
      settingsSuccess.textContent = t("settings.fontSize") + " " + t("settings.updated");
    }, 280);
  });
  fontSizeSlider.addEventListener("change", () => {
    syncFontSizeUi(getPreferences().fontSize);
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
  const logoutAllBtn = document.getElementById("logout-all-btn") as HTMLButtonElement;

  function formatSessionWhen(iso: string | undefined): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function closeSessionMenus() {
    activeSessionsList.querySelectorAll(".session-menu.open").forEach((el) => el.classList.remove("open"));
  }

  document.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest?.(".session-actions")) closeSessionMenus();
  });

  async function loadActiveSessions() {
    activeSessionsList.innerHTML = `
      <div class="sessions-head">
        <span>${t("settings.sessionDevice")}</span>
        <span>${t("settings.sessionCreated")}</span>
        <span>${t("settings.sessionExpires")}</span>
        <span aria-hidden="true"></span>
      </div>
      <p class="settings-muted sessions-empty">${t("settings.loadingSessions")}</p>`;
    try {
      const data = await apiRequest<any[]>("/api/sessions", { method: "GET" });
      const sessions: any[] = Array.isArray(data) ? data : [];
      activeSessionsList.innerHTML = `
        <div class="sessions-head">
          <span>${t("settings.sessionDevice")}</span>
          <span>${t("settings.sessionCreated")}</span>
          <span>${t("settings.sessionExpires")}</span>
          <span aria-hidden="true"></span>
        </div>`;
      if (sessions.length === 0) {
        const empty = document.createElement("p");
        empty.className = "settings-muted sessions-empty";
        empty.textContent = t("settings.noActiveSessions");
        activeSessionsList.appendChild(empty);
        return;
      }

      sessions.forEach((session: any) => {
        const row = document.createElement("div");
        row.className = "session-row" + (session.is_current ? " is-current" : "");

        const device = document.createElement("div");
        device.className = "session-device";
        const name = document.createElement("span");
        name.className = "session-device-name";
        name.textContent = session.device || t("settings.unknownDevice");
        device.appendChild(name);
        if (session.user_agent) {
          const uaLine = document.createElement("span");
          uaLine.className = "session-ua";
          uaLine.title = session.user_agent;
          // Short secondary line: first ~48 chars of the raw UA for power users
          const short =
            session.user_agent.length > 48
              ? session.user_agent.slice(0, 48) + "…"
              : session.user_agent;
          uaLine.textContent = short;
          device.appendChild(uaLine);
        }
        if (session.is_current) {
          const badge = document.createElement("span");
          badge.className = "session-current-badge";
          badge.textContent = t("settings.sessionCurrent");
          device.appendChild(badge);
        }

        const created = document.createElement("div");
        created.className = "session-col";
        created.textContent = formatSessionWhen(session.created_at);

        const expires = document.createElement("div");
        expires.className = "session-col";
        expires.textContent = formatSessionWhen(session.expires_at);

        const actions = document.createElement("div");
        actions.className = "session-actions";
        if (!session.is_current) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = "icon-btn session-more-btn";
          more.setAttribute("aria-label", t("settings.sessionMore"));
          more.innerHTML = "⋮";
          const menu = document.createElement("div");
          menu.className = "session-menu";
          const terminate = document.createElement("button");
          terminate.type = "button";
          terminate.className = "session-menu-item danger";
          terminate.textContent = t("settings.revokeSession");
          terminate.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            terminate.disabled = true;
            try {
              await apiRequest(`/api/sessions/${session.id}`, { method: "DELETE" });
              loadActiveSessions();
            } catch (err) {
              settingsError.textContent =
                err instanceof ApiError ? err.message : t("settings.sessionsNotAvailable");
              terminate.disabled = false;
            }
          });
          menu.appendChild(terminate);
          more.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const open = menu.classList.contains("open");
            closeSessionMenus();
            if (!open) menu.classList.add("open");
          });
          actions.appendChild(more);
          actions.appendChild(menu);
        }

        row.appendChild(device);
        row.appendChild(created);
        row.appendChild(expires);
        row.appendChild(actions);
        activeSessionsList.appendChild(row);
      });
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status !== 404
          ? err.message
          : t("settings.sessionsNotAvailable");
      activeSessionsList.innerHTML = `
        <div class="sessions-head">
          <span>${t("settings.sessionDevice")}</span>
          <span>${t("settings.sessionCreated")}</span>
          <span>${t("settings.sessionExpires")}</span>
          <span aria-hidden="true"></span>
        </div>
        <p class="settings-muted sessions-empty">${msg}</p>`;
    }
  }
  loadActiveSessions();

  logoutAllBtn?.addEventListener("click", async () => {
    const ok = await showConfirm({
      title: t("settings.logoutAll"),
      message: t("settings.logoutAllConfirm"),
      confirmLabel: t("menu.logout"),
      danger: true,
    });
    if (!ok) return;
    logoutAllBtn.disabled = true;
    settingsError.textContent = "";
    try {
      await apiRequest("/api/sessions/logout-all", { method: "POST", body: "{}" });
      // End this browser session too — matches "log out of all devices".
      await api.logout().catch(() => {});
      window.location.reload();
    } catch (err) {
      settingsError.textContent =
        err instanceof ApiError ? err.message : t("settings.sessionsNotAvailable");
      logoutAllBtn.disabled = false;
    }
  });

  const cancelDeletionBtn = document.getElementById("cancel-deletion-btn") as HTMLButtonElement | null;
  const deleteAccountStatus = document.getElementById("delete-account-status") as HTMLDivElement | null;

  function syncDeletionUi(user: User) {
    const pending = !!user.deletion_requested_at;
    if (cancelDeletionBtn) cancelDeletionBtn.style.display = pending ? "" : "none";
    if (deleteAccountBtn) {
      deleteAccountBtn.style.display = pending ? "none" : "";
      deleteAccountBtn.disabled = false;
    }
    if (deleteAccountStatus) {
      if (pending && user.deletion_requested_at) {
        const purge = new Date(
          new Date(user.deletion_requested_at).getTime() + 7 * 24 * 60 * 60 * 1000
        );
        deleteAccountStatus.style.display = "";
        deleteAccountStatus.textContent = t("settings.deletionPending").replace(
          "{date}",
          purge.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        );
      } else {
        deleteAccountStatus.style.display = "none";
        deleteAccountStatus.textContent = "";
      }
    }
  }

  deletionUiSync = syncDeletionUi;
  if (currentUser) syncDeletionUi(currentUser);

  deleteAccountBtn.addEventListener("click", async () => {
    const ok = await showConfirm({
      title: t("settings.deleteAccount"),
      message: t("settings.deleteAccountConfirmSoft"),
      confirmLabel: t("settings.deleteAccountShort"),
      danger: true,
    });
    if (!ok) return;
    deleteAccountBtn.disabled = true;
    settingsError.textContent = "";
    try {
      const data = await apiRequest<{
        ok: boolean;
        soft?: boolean;
        purge_at?: string;
        email_sent?: boolean;
        user?: User;
      }>("/api/user/delete", { method: "DELETE" });
      if (data.user) {
        currentUser = data.user;
        onUserUpdated(data.user);
        syncDeletionUi(data.user);
      }
      settingsSuccess.textContent = data.email_sent
        ? t("settings.deletionEmailSent")
        : t("settings.deletionScheduled");
      // Stay signed in during the grace period — no reload/logout.
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.deleteAccountError");
      deleteAccountBtn.disabled = false;
    }
  });

  cancelDeletionBtn?.addEventListener("click", async () => {
    cancelDeletionBtn.disabled = true;
    settingsError.textContent = "";
    try {
      const data = await apiRequest<{ ok: boolean; user?: User }>("/api/user/cancel-deletion", {
        method: "POST",
        body: "{}",
      });
      if (data.user) {
        currentUser = data.user;
        onUserUpdated(data.user);
        syncDeletionUi(data.user);
      } else if (currentUser) {
        currentUser = { ...currentUser, deletion_requested_at: null };
        syncDeletionUi(currentUser);
      }
      settingsSuccess.textContent = t("settings.deletionCancelled");
    } catch (err) {
      settingsError.textContent = err instanceof ApiError ? err.message : t("settings.deleteAccountError");
    } finally {
      cancelDeletionBtn.disabled = false;
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
