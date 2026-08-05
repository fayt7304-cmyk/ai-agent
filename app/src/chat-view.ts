import { api, ApiError, type Conversation, type Message, type Attachment, type User, type Visibility } from "./api";
import { readFileAsDataUrl, formatBytes, fileIcon, MAX_FILE_BYTES } from "./files";
import { showConfirm, showPrompt } from "./lib/dialog";
import { renderFileList, downloadAllFiles } from "./lib/file-downloads";
import { speak, stopSpeaking } from "./lib/speech";
import { renderMarkdown } from "./lib/markdown";
import { openLeadModal } from "./lead-view";
import { applyAvatar } from "./lib/avatar";
import { openSettings } from "./settings-view";
import { t } from "./lib/i18n";
import { icons } from "./lib/icons";

/**
 * Every chat is addressable: the URL always carries `#conv=<id>` for the open
 * conversation, so a refresh, a bookmark, or a pasted link reopens that exact chat
 * instead of dropping the user into a blank new one.
 */
function conversationUrl(id: string) {
  return `${window.location.origin}${window.location.pathname}#conv=${id}`;
}

/**
 * Writes the open conversation into the address bar. `internalHashUpdate` keeps our
 * own writes from re-triggering the `hashchange` listener (which would reload the
 * conversation we just opened).
 */
let internalHashUpdate = false;
function syncUrlToConversation(id: string | null) {
  const target = id ? `#conv=${id}` : "";
  const current = window.location.hash;
  if (current === target || (!id && current === "")) return;
  internalHashUpdate = true;
  if (id) {
    history.replaceState(null, "", conversationUrl(id));
  } else {
    history.replaceState(null, "", `${window.location.origin}${window.location.pathname}`);
  }
  // Let any queued hashchange event flush before we listen again.
  setTimeout(() => {
    internalHashUpdate = false;
  }, 0);
}

interface QuickAction {
  labelKey: string;
  promptKey?: string;
  openLead?: boolean;
}

// A-F Marbre specific shortcuts. Edit freely — "openLead" opens the quote-request
// modal instead of sending a chat message. Labels/prompts are translated via the
// i18n keys in src/lib/i18n.ts.
const QUICK_ACTIONS: QuickAction[] = [
  { labelKey: "quick.storeHours", promptKey: "quick.storeHours.prompt" },
  { labelKey: "quick.location", promptKey: "quick.location.prompt" },
  { labelKey: "quick.getQuote", openLead: true },
];

// Mobile browsers (especially over cellular, with tighter memory limits) can fail to
// render very large images when they're embedded directly as a base64 "data:" URI in
// an <img src>. Converting to a Blob object URL first is far more reliable across
// devices and uses less memory, since the browser handles it as a real binary resource
// instead of a giant inline text string. Falls back to the raw data URL if conversion
// fails for any reason (e.g. a malformed data URI), so nothing regresses.
function dataUrlToObjectUrl(dataUrl: string): string {
  try {
    const [header, base64] = dataUrl.split(",");
    const mimeMatch = header.match(/data:(.*);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return dataUrl;
  }
}

const sidebar = document.getElementById("sidebar") as HTMLDivElement;
const sidebarToggle = document.getElementById("sidebar-toggle") as HTMLButtonElement;
const sidebarOpenBtn = document.getElementById("sidebar-open-btn") as HTMLButtonElement;
const sidebarSearchBtn = document.getElementById("sidebar-search-btn") as HTMLButtonElement;
const sidebarSearchRow = document.getElementById("sidebar-search-row") as HTMLDivElement;
const sidebarSearchInput = document.getElementById("sidebar-search-input") as HTMLInputElement;
const sidebarSearchClose = document.getElementById("sidebar-search-close") as HTMLButtonElement;
const convoList = document.getElementById("convo-list") as HTMLDivElement;
const newChatBtn = document.getElementById("new-chat-btn") as HTMLButtonElement;
const chatTitle = document.getElementById("chat-title") as HTMLDivElement;
const messagesEl = document.getElementById("messages") as HTMLDivElement;
const emptyState = document.getElementById("empty-state") as HTMLDivElement;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const attachBtn = document.getElementById("attach-btn") as HTMLButtonElement;
const attachMenu = document.getElementById("attach-menu") as HTMLDivElement;
const attachMenuFiles = document.getElementById("attach-menu-files") as HTMLButtonElement;
const attachMenuTools = document.getElementById("attach-menu-tools") as HTMLButtonElement;
const micBtn = document.getElementById("mic-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const attachmentChips = document.getElementById("attachment-chips") as HTMLDivElement;
const composerRow = document.querySelector(".composer-row") as HTMLDivElement;
const composerHint = document.getElementById("composer-hint") as HTMLDivElement;
const sidebarUsername = document.getElementById("sidebar-username") as HTMLDivElement;
const userAvatar = document.getElementById("user-avatar") as HTMLSpanElement;
const quickActionsEl = document.getElementById("quick-actions") as HTMLDivElement;

// Fill in the static icon buttons that only carry an aria/title in markup — kept out
// of index.html so all icon markup lives in one place (lib/icons.ts).
/** Menu rows render as `[icon][label]` with the gap owned by CSS only — a raw
 *  text node after the icon span added an extra whitespace character, which is
 *  what made the icon/label spacing look uneven between rows. */
function menuItemHtml(icon: string, label: string) {
  return `<span class="menu-icon">${icon}</span><span class="menu-label">${label}</span>`;
}

function mountStaticIcons() {
  sidebarToggle.innerHTML = icons.panel;
  sidebarOpenBtn.innerHTML = icons.panel;
  sidebarSearchBtn.innerHTML = icons.search;
  sidebarSearchClose.innerHTML = icons.close;
  document.querySelector(".new-chat-icon")!.innerHTML = icons.plus;
  document.querySelector(".sidebar-search-icon")!.innerHTML = icons.search;
  document.querySelector(".install-app-icon")!.innerHTML = icons.download;
  attachBtn.innerHTML = icons.plus;
  document.querySelector("#attach-menu-files .attach-menu-icon")!.innerHTML = icons.image;
  document.querySelector("#attach-menu-tools .attach-menu-icon")!.innerHTML = icons.tools;
  micBtn.innerHTML = icons.mic;
  document.querySelector(".send-icon")!.innerHTML = icons.send;
  document.getElementById("header-usage-btn")!.innerHTML = icons.chart;
  document.getElementById("header-files-btn")!.innerHTML = icons.fileSearch;
  document.getElementById("header-share-btn")!.innerHTML = icons.share;
  document.getElementById("header-more-btn")!.innerHTML = icons.more;

  // Add icons to More menu items
  const moreRenameBtn = document.getElementById("more-rename");
  const moreStarBtn = document.getElementById("more-star");
  const moreArchiveBtn = document.getElementById("more-archive");
  const moreDeleteBtn = document.getElementById("more-delete");
  if (moreRenameBtn) moreRenameBtn.innerHTML = menuItemHtml(icons.pencil, t("convo.rename"));
  if (moreStarBtn) moreStarBtn.innerHTML = menuItemHtml(icons.star, t("convo.star"));
  if (moreArchiveBtn) moreArchiveBtn.innerHTML = menuItemHtml(icons.archive, t("convo.archive"));
  if (moreDeleteBtn) moreDeleteBtn.innerHTML = menuItemHtml(icons.close, t("convo.delete"));

  // Add icons to Share menu items
  const shareOnlyMe = document.getElementById("share-only-me");
  const shareWithPeople = document.getElementById("share-with-people");
  const shareCollab = document.getElementById("share-collaboration");
  if (shareOnlyMe) shareOnlyMe.innerHTML = menuItemHtml(icons.lock, t("share.onlyMe"));
  if (shareWithPeople) shareWithPeople.innerHTML = menuItemHtml(icons.people, t("share.everyone"));
  if (shareCollab) shareCollab.innerHTML = menuItemHtml(icons.link, t("share.collab"));

  wireHeaderActions();
}

// ---- Header action wiring ----

function wireHeaderActions() {
  // Usage modal — loads real stats when opened
  const usageModal = document.getElementById("usage-modal") as HTMLDivElement;
  const usageCloseBtn = document.getElementById("usage-close-btn") as HTMLButtonElement;
  document.getElementById("header-usage-btn")?.addEventListener("click", () => {
    openUsageModal();
  });
  usageCloseBtn.addEventListener("click", () => {
    usageModal.style.display = "none";
  });
  usageModal.addEventListener("click", (e) => {
    if (e.target === usageModal) usageModal.style.display = "none";
  });

  // Files modal — loads real files when opened
  const filesModal = document.getElementById("files-modal") as HTMLDivElement;
  const filesCloseBtn = document.getElementById("files-close-btn") as HTMLButtonElement;
  document.getElementById("header-files-btn")?.addEventListener("click", () => {
    openFilesModal();
  });
  filesCloseBtn.addEventListener("click", () => {
    filesModal.style.display = "none";
  });
  filesModal.addEventListener("click", (e) => {
    if (e.target === filesModal) filesModal.style.display = "none";
  });

  // Share menu — real actions
  const shareMenu = document.getElementById("share-menu") as HTMLDivElement;
  const shareBtn = document.getElementById("header-share-btn") as HTMLButtonElement;

  // Share menu — real actions. Each option sets the conversation's visibility on the
  // server and copies a `#conv=<id>` deep-link; the difference is who may open it
  // (enforced server-side):
  //   private -> only the owner
  //   shared  -> anyone signed in with the link can read
  //   collab  -> anyone signed in with the link can read AND reply
  async function shareCurrentConversation(visibility: Visibility, copyLink: boolean) {
    if (!currentConversationId) {
      showToast(t("share.needsChat"));
      return;
    }
    const id = currentConversationId;
    try {
      await api.setConversationVisibility(id, visibility);
      const convo = conversations.find((c) => c.id === id);
      if (convo) convo.visibility = visibility;
    } catch {
      showToast(t("share.failed"));
      return;
    }
    const done =
      visibility === "private"
        ? t("share.private")
        : visibility === "collab"
          ? "Collab link copied — anyone with it can read and reply."
          : t("share.shared");
    if (!copyLink) {
      showToast(done);
      return;
    }
    const url = conversationUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      showToast(done);
    } catch {
      showToast("Could not copy link. URL: " + url);
    }
  }

  document.getElementById("share-only-me")?.addEventListener("click", () => {
    shareMenu.style.display = "none";
    shareCurrentConversation("private", true);
  });
  document.getElementById("share-with-people")?.addEventListener("click", () => {
    shareMenu.style.display = "none";
    shareCurrentConversation("shared", true);
  });
  document.getElementById("share-collaboration")?.addEventListener("click", () => {
    shareMenu.style.display = "none";
    shareCurrentConversation("collab", true);
  });

  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    shareMenu.style.display = shareMenu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", (e) => {
    if (!shareBtn.contains(e.target as Node) && !shareMenu.contains(e.target as Node)) {
      shareMenu.style.display = "none";
    }
  });

  // More menu — real actions
  const moreMenu = document.getElementById("more-menu") as HTMLDivElement;
  const moreBtn = document.getElementById("header-more-btn") as HTMLButtonElement;

  document.getElementById("more-rename")?.addEventListener("click", async () => {
    moreMenu.style.display = "none";
    if (!currentConversationId) {
      showToast(t("convo.needsChat"));
      return;
    }
    const convo = conversations.find((c) => c.id === currentConversationId);
    if (!convo) return;
    const newTitle = await showPrompt({
      title: t("convo.rename"),
      message: t("convo.renamePrompt"),
      value: convo.title,
      confirmLabel: t("convo.save"),
    });
    if (newTitle && newTitle !== convo.title) {
      convo.title = newTitle;
      chatTitle.textContent = newTitle;
      renderConvoList();
      api.renameConversation(convo.id, newTitle).catch(() => {
        // Best-effort — title still shows locally
      });
    }
  });

  document.getElementById("more-star")?.addEventListener("click", async () => {
    moreMenu.style.display = "none";
    if (!currentConversationId) {
      showToast(t("convo.needsChat"));
      return;
    }
    const convo = conversations.find((c) => c.id === currentConversationId);
    if (!convo) return;
    try {
      const result = await api.starConversation(convo.id);
      convo.starred = result.starred;
      renderConvoList();
      updateMoreMenuStarLabel();
      showToast(result.starred ? t("convo.starred") : t("convo.unstarred"));
    } catch (e) {
      showToast(t("convo.actionFailed"));
    }
  });

  document.getElementById("more-archive")?.addEventListener("click", async () => {
    moreMenu.style.display = "none";
    if (!currentConversationId) {
      showToast(t("convo.needsChat"));
      return;
    }
    const convo = conversations.find((c) => c.id === currentConversationId);
    if (!convo) return;
    try {
      const result = await api.archiveConversation(convo.id);
      convo.archived = result.archived;
      if (result.archived) {
        // Deselect, but keep it in `conversations` — it now shows under the
        // sidebar's collapsible "Archived" section instead of disappearing.
        setCurrentConversation(null);
        renderMessages([]);
        chatTitle.textContent = t("chat.newChat");
        showToast(t("convo.archived"));
      } else {
        showToast(t("convo.unarchived"));
      }
      renderConvoList();
    } catch (e) {
      showToast(t("convo.actionFailed"));
    }
  });

  document.getElementById("more-delete")?.addEventListener("click", async () => {
    moreMenu.style.display = "none";
    if (!currentConversationId) {
      showToast(t("convo.needsChat"));
      return;
    }
    const convo = conversations.find((c) => c.id === currentConversationId);
    if (!convo) return;
    const ok = await showConfirm({
      title: t("convo.deleteTitle"),
      message: t("convo.deleteMessage").replace("{title}", convo.title),
      confirmLabel: t("convo.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteConversation(convo.id);
      conversations = conversations.filter((c) => c.id !== convo.id);
      setCurrentConversation(null);
      renderMessages([]);
      chatTitle.textContent = t("chat.newChat");
      renderConvoList();
      showToast("Conversation deleted");
    } catch (e) {
      showToast("Could not delete conversation.");
    }
  });

  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    updateMoreMenuStarLabel();
    updateMoreMenuArchiveLabel();
    moreMenu.style.display = moreMenu.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", (e) => {
    if (!moreBtn.contains(e.target as Node) && !moreMenu.contains(e.target as Node)) {
      moreMenu.style.display = "none";
    }
  });
}

/** Update the Star menu item label to reflect current state */
function updateMoreMenuStarLabel() {
  const moreStarBtn = document.getElementById("more-star");
  if (!moreStarBtn) return;
  const convo = currentConversationId ? conversations.find((c) => c.id === currentConversationId) : null;
  const isStarred = convo?.starred ?? false;
  moreStarBtn.innerHTML = menuItemHtml(
    isStarred ? icons.starFilled : icons.star,
    isStarred ? t("convo.unstar") : t("convo.star")
  );
}

/** Update the Archive menu item label to reflect current state */
function updateMoreMenuArchiveLabel() {
  const moreArchiveBtn = document.getElementById("more-archive");
  if (!moreArchiveBtn) return;
  const convo = currentConversationId ? conversations.find((c) => c.id === currentConversationId) : null;
  const isArchived = convo?.archived ?? false;
  moreArchiveBtn.innerHTML = menuItemHtml(icons.archive, isArchived ? t("convo.unarchive") : t("convo.archive"));
}

/** Open the Usage modal and populate it with real data for the current conversation */
async function openUsageModal() {
  const usageModal = document.getElementById("usage-modal") as HTMLDivElement;
  const tokensEl = document.getElementById("usage-credits");
  const messagesCountEl = document.getElementById("usage-messages");
  const timeEl = document.getElementById("usage-time");

  // Placeholders are em dashes, never invented numbers.
  const setAll = (value: string) => {
    if (tokensEl) tokensEl.textContent = value;
    if (messagesCountEl) messagesCountEl.textContent = value;
    if (timeEl) timeEl.textContent = value;
  };

  setAll("…");
  usageModal.style.display = "flex";

  if (!currentConversationId) {
    setAll("—");
    return;
  }

  try {
    const usage = await api.getConversationUsage(currentConversationId);
    if (tokensEl) tokensEl.textContent = usage.estimated_tokens.toLocaleString();
    if (messagesCountEl) {
      messagesCountEl.textContent = String(usage.user_messages + usage.agent_messages);
    }
    if (timeEl) timeEl.textContent = usage.time_worked;
  } catch {
    setAll("—");
  }
}

/** Open the Files modal and populate it with real attachment data */
async function openFilesModal() {
  const filesModal = document.getElementById("files-modal") as HTMLDivElement;
  const filesContent = document.getElementById("files-content") as HTMLDivElement;
  const downloadAllBtn = document.getElementById("files-download-all-btn") as HTMLButtonElement | null;

  filesContent.innerHTML = `<p class="settings-muted">${t("files.loading")}</p>`;
  if (downloadAllBtn) downloadAllBtn.style.display = "none";
  filesModal.style.display = "flex";

  if (!currentConversationId) {
    filesContent.innerHTML = `<p class="settings-muted">${t("files.noConversation")}</p>`;
    return;
  }

  try {
    const { files } = await api.getConversationFiles(currentConversationId);

    if (!files || files.length === 0) {
      filesContent.innerHTML = `<p class="settings-muted">${t("files.emptyConversation")}</p>`;
      return;
    }

    if (downloadAllBtn) {
      const downloadable = files.filter((f: any) => f.dataUrl);
      downloadAllBtn.style.display = downloadable.length ? "inline-flex" : "none";
      downloadAllBtn.onclick = () => downloadAllFiles(files as any);
    }

    renderFileList(filesContent, files as any, (f: any) =>
      `${formatBytes(f.size)} · ${f.role === "user" ? t("files.fromYou") : t("files.fromPaul")} · ${new Date(f.created_at).toLocaleDateString()}`
    );
  } catch {
    filesContent.innerHTML = `<p class="settings-muted">${t("files.loadError")}</p>`;
  }
}

// ---- Toast notification ----
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, duration = 3000) {
  let toast = document.getElementById("chat-toast") as HTMLDivElement;
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "chat-toast";
    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--surface-elevated, #333);
      color: var(--text, #fff);
      padding: 8px 18px;
      border-radius: 20px;
      font-size: 13px;
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      white-space: nowrap;
      box-shadow: 0 2px 12px rgba(0,0,0,0.18);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = "1";
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.opacity = "0";
  }, duration);
}

let currentUser: User;
let conversations: Conversation[] = [];
let currentConversationId: string | null = null;
/** True when the open chat belongs to someone else and isn't shared for collab. */
let currentChatReadOnly = false;

/**
 * Single place where the open conversation changes, so the address bar always
 * matches what's on screen (refresh reopens the same chat, never a blank one).
 */
function setCurrentConversation(id: string | null) {
  currentConversationId = id;
  syncUrlToConversation(id);
}
let pendingAttachments: (Attachment & { dataUrl: string })[] = [];
let lastUserText = "";
let lastUserAttachments: (Attachment & { dataUrl: string })[] = [];
let lastAgentRow: HTMLDivElement | null = null;

function setHint(text: string, isError = false) {
  composerHint.textContent = text;
  composerHint.classList.toggle("error", isError);
}

// ---- Per-conversation "..." dropdown (sidebar) ----
let openConvoMenuEl: HTMLDivElement | null = null;
let openConvoMenuFor: string | null = null;

function closeConvoMenu() {
  if (openConvoMenuEl) openConvoMenuEl.remove();
  openConvoMenuEl = null;
  openConvoMenuFor = null;
}
document.addEventListener("click", closeConvoMenu);
window.addEventListener("resize", closeConvoMenu);
document.addEventListener(
  "scroll",
  (e) => {
    // Don't close for scroll events happening inside the dropdown itself
    if (openConvoMenuEl && e.target instanceof Node && openConvoMenuEl.contains(e.target)) return;
    closeConvoMenu();
  },
  true
);

/**
 * Opens the "..." dropdown for a single conversation item in the sidebar, anchored
 * to the dots button that triggered it. Appended to <body> (not the item) so it
 * isn't clipped by the sidebar list's overflow-y:auto scroll container.
 */
function openConvoMenu(anchor: HTMLElement, c: Conversation, startRename: () => void) {
  if (openConvoMenuFor === c.id) {
    closeConvoMenu();
    return;
  }
  closeConvoMenu();

  const menu = document.createElement("div");
  menu.className = "header-dropdown convo-dropdown";
  menu.style.display = "block";
  document.body.appendChild(menu);
  openConvoMenuEl = menu;
  openConvoMenuFor = c.id;

  const addItem = (label: string, iconSvg: string, onClick: () => void, danger = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "more-option" + (danger ? " danger" : "");
    btn.innerHTML = `<span class="menu-icon">${iconSvg}</span> ${label}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeConvoMenu();
      onClick();
    });
    menu.appendChild(btn);
  };

  addItem(t("convo.rename"), icons.pencil, () => startRename());
  addItem(c.starred ? "Unstar" : "Star", c.starred ? icons.starFilled : icons.star, async () => {
    try {
      const result = await api.starConversation(c.id);
      c.starred = result.starred;
      renderConvoList();
      showToast(result.starred ? "⭐ Conversation starred" : "Conversation unstarred");
    } catch {
      showToast("Could not update star status.");
    }
  });
  addItem("Copy Link", icons.link, async () => {
    const url = conversationUrl(c.id);
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard!");
    } catch {
      showToast("Could not copy link. URL: " + url);
    }
  });
  addItem(c.archived ? "Unarchive" : "Archive", icons.archive, async () => {
    try {
      const result = await api.archiveConversation(c.id);
      c.archived = result.archived;
      if (result.archived) {
        // Deselect, but keep it in `conversations` — it moves to the sidebar's
        // collapsible "Archived" section instead of disappearing.
        if (currentConversationId === c.id) {
          setCurrentConversation(null);
          renderMessages([]);
          chatTitle.textContent = t("chat.newChat");
        }
        showToast("Conversation archived");
      } else {
        showToast("Conversation unarchived");
      }
      renderConvoList();
    } catch {
      showToast("Could not archive conversation.");
    }
  });
  addItem(
    "Delete",
    icons.close,
    async () => {
      const ok = await showConfirm({
        title: t("convo.deleteTitle"),
        message: t("convo.deleteMessage").replace("{title}", c.title),
        confirmLabel: t("convo.delete"),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.deleteConversation(c.id);
        conversations = conversations.filter((x) => x.id !== c.id);
        if (currentConversationId === c.id) {
          setCurrentConversation(null);
          renderMessages([]);
          chatTitle.textContent = t("chat.newChat");
        }
        renderConvoList();
      } catch {
        showToast("Could not delete conversation.");
      }
    },
    true
  );

  // Position after the menu has real dimensions, anchored to the dots button,
  // flipped to stay inside the viewport on narrow / mobile screens. Direction-aware:
  // in RTL the menu should hug the anchor's left edge (its "start" side) instead of
  // its right edge.
  const isRtl = document.documentElement.dir === "rtl" || getComputedStyle(document.documentElement).direction === "rtl";
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let top = rect.bottom + 4;
  if (top + menuRect.height > window.innerHeight) top = Math.max(4, rect.top - menuRect.height - 4);
  let left = isRtl ? rect.left : rect.right - menuRect.width;
  if (left < 4) left = 4;
  if (left + menuRect.width > window.innerWidth - 4) left = window.innerWidth - menuRect.width - 4;
  menu.style.position = "fixed";
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.style.right = "auto";
}

let archivedExpanded = false;

/** Builds a single sidebar row (used for both active and archived conversations). */
function createConvoItem(c: Conversation): HTMLDivElement {
  const item = document.createElement("div");
  item.className =
    "convo-item" +
    (c.id === currentConversationId ? " active" : "") +
    (c.starred ? " starred" : "") +
    (c.archived ? " archived" : "");
  const title = document.createElement("span");
  title.className = "convo-title";

  // Show star indicator inline with title
  if (c.starred) {
    const starSpan = document.createElement("span");
    starSpan.className = "convo-star-indicator";
    starSpan.innerHTML = icons.starFilled;
    starSpan.style.cssText = "display:inline-flex;align-items:center;margin-inline-end:4px;color:var(--accent,#f5a623);width:14px;height:14px;flex-shrink:0;";
    title.appendChild(starSpan);
  }
  const titleText = document.createTextNode(c.title);
  title.appendChild(titleText);

  function startRename() {
    const input = document.createElement("input");
    input.className = "convo-title-input";
    input.type = "text";
    input.value = c.title;
    item.replaceChild(input, title);
    item.classList.add("renaming");
    input.focus();
    input.select();

    let done = false;
    async function commit() {
      if (done) return;
      done = true;
      const newTitle = input.value.trim();
      item.classList.remove("renaming");
      if (newTitle && newTitle !== c.title) {
        c.title = newTitle;
        if (c.id === currentConversationId) chatTitle.textContent = newTitle;
        try {
          await api.renameConversation(c.id, newTitle);
        } catch {
          // Best-effort — the new title still shows locally even if the save fails.
        }
      }
      renderConvoList();
    }
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        done = true;
        item.classList.remove("renaming");
        renderConvoList();
      }
    });
    input.addEventListener("click", (e) => e.stopPropagation());
  }

  const dots = document.createElement("button");
  dots.className = "convo-dots";
  dots.innerHTML = icons.more;
  dots.type = "button";
  dots.title = "More options";
  dots.addEventListener("click", (e) => {
    e.stopPropagation();
    openConvoMenu(dots, c, startRename);
  });

  item.appendChild(title);
  item.appendChild(dots);
  item.addEventListener("click", () => selectConversation(c.id));
  return item;
}

function renderConvoList() {
  convoList.innerHTML = "";
  const active = conversations.filter((c) => !c.archived);
  const archived = conversations.filter((c) => c.archived);

  for (const c of active) {
    convoList.appendChild(createConvoItem(c));
  }

  if (archived.length > 0) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "convo-archived-toggle" + (archivedExpanded ? " expanded" : "");
    toggle.innerHTML = `<span class="convo-archived-chevron">${icons.chevronRight}</span><span class="menu-icon">${icons.archive}</span> Archived (${archived.length})`;
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      archivedExpanded = !archivedExpanded;
      renderConvoList();
    });
    convoList.appendChild(toggle);

    if (archivedExpanded) {
      const archivedWrap = document.createElement("div");
      archivedWrap.className = "convo-archived-list";
      for (const c of archived) {
        archivedWrap.appendChild(createConvoItem(c));
      }
      convoList.appendChild(archivedWrap);
    }
  }
}

async function loadConversations() {
  const { conversations: list } = await api.listConversations();
  // Normalize starred/archived from 0/1 integers to booleans
  conversations = list.map((c: any) => ({
    ...c,
    starred: !!c.starred,
    archived: !!c.archived,
  }));
  renderConvoList();
}

/** Shows a full-width "you can't see this" state in place of the message list. */
function renderAccessForbidden(message: string) {
  messagesEl.innerHTML = "";
  emptyState.style.display = "none";
  const wrap = document.createElement("div");
  wrap.className = "access-forbidden";
  wrap.innerHTML = `
    <div class="access-forbidden-icon">${icons.lock}</div>
    <div class="access-forbidden-title">Access forbidden</div>
    <div class="access-forbidden-text">${message}</div>
  `;
  messagesEl.appendChild(wrap);
}

/**
 * Puts the composer into (or out of) read-only mode. A chat someone shared for
 * reading only still opens fine — you just get a banner instead of an input box,
 * rather than a dead composer that errors when you press send.
 */
function setComposerReadOnly(readOnly: boolean, reason = "") {
  currentChatReadOnly = readOnly;
  const form = document.getElementById("chat-form") as HTMLElement | null;
  let notice = document.getElementById("readonly-notice") as HTMLDivElement | null;
  if (form) form.style.display = readOnly ? "none" : "";
  if (readOnly) {
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "readonly-notice";
      notice.className = "readonly-notice";
      form?.parentElement?.appendChild(notice);
    }
    notice.innerHTML = `<span class="menu-icon">${icons.lock}</span><span></span>`;
    notice.querySelector("span:last-child")!.textContent = reason;
    notice.style.display = "flex";
  } else if (notice) {
    notice.style.display = "none";
  }
}

/**
 * Opens a conversation from a `#conv=<id>` link. Unlike selectConversation, the
 * conversation may not belong to the current user and may not be in their sidebar
 * list — so this fetches messages directly, honours the server's `can_write` flag
 * (collab links stay writable) and shows a clear access state on 403/404.
 */
async function openConversationLink(id: string) {
  setCurrentConversation(id);
  renderConvoList();
  messagesEl.innerHTML = "";
  chatTitle.textContent = "…";
  try {
    const { messages, conversation } = await api.getMessages(id);
    chatTitle.textContent = conversation?.title || t("chat.newChat");
    renderMessages(messages);
    const canWrite = conversation ? conversation.can_write !== false : true;
    if (canWrite) {
      setComposerReadOnly(false);
      if (conversation && !conversation.owner) {
        showToast("You've been invited to collaborate on this chat — you can reply.");
      }
    } else {
      setComposerReadOnly(true, "Read-only: the owner shared this chat for viewing.");
      showToast("Viewing a conversation shared with you — read access only.");
    }
  } catch (e) {
    setCurrentConversation(null);
    chatTitle.textContent = t("chat.newChat");
    setComposerReadOnly(false);
    if (e instanceof ApiError && e.status === 403) {
      renderAccessForbidden("This conversation is private. Ask the owner to share a link with access.");
    } else {
      renderAccessForbidden("This conversation doesn't exist or is no longer available.");
    }
  }
  // Use toggleSidebar() rather than touching the class directly: it also syncs
  // the header "open sidebar" button, which otherwise stayed hidden on mobile
  // after switching chats, leaving no way to reopen the sidebar.
  if (window.innerWidth <= 720) toggleSidebar(true);
}

/** Checks the URL for a `#conv=<id>` link and opens it if present. */
function handleConvoLinkFromHash() {
  if (internalHashUpdate) return;
  const match = window.location.hash.match(/#conv=([^&]+)/);
  if (match) openConversationLink(decodeURIComponent(match[1]));
}
window.addEventListener("hashchange", handleConvoLinkFromHash);

function makeIconActionBtn(icon: keyof typeof icons, title: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "msg-action-btn";
  btn.type = "button";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = icons[icon];
  return btn;
}

function addMsgRow(kind: "user" | "agent" | "error" | "thinking", content: string, attachments: Attachment[] = []) {
  emptyState.style.display = "none";
  const row = document.createElement("div");
  row.className = `msg-row ${kind === "thinking" ? "agent thinking" : kind}`;

  const bubble = document.createElement("div");
  bubble.className = "msg";
  if (kind === "agent") {
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.textContent = content;
  }
  row.appendChild(bubble);

  if (attachments.length) {
    const chipsWrap = document.createElement("div");
    chipsWrap.className = "msg-attachments";
    for (const a of attachments) {
      if (a.mime.startsWith("image/") && a.dataUrl) {
        const objectUrl = dataUrlToObjectUrl(a.dataUrl);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.target = "_blank";
        link.rel = "noopener";
        const img = document.createElement("img");
        img.className = "msg-image";
        img.src = objectUrl;
        img.alt = a.name;
        // If even the Blob URL fails to load for some reason, fall back to the raw
        // data URL once before giving up — better than a permanently broken image.
        img.addEventListener(
          "error",
          () => {
            if (img.src !== a.dataUrl) img.src = a.dataUrl!;
          },
          { once: true }
        );
        link.appendChild(img);
        chipsWrap.appendChild(link);
      } else {
        // Uploaded files show as a card: icon tile, file name, then type + size.
        const isDownloadable = Boolean(a.dataUrl);
        const chip = document.createElement(isDownloadable ? "a" : "div");
        chip.className = "msg-attachment-chip";
        if (isDownloadable) {
          const anchor = chip as HTMLAnchorElement;
          anchor.href = dataUrlToObjectUrl(a.dataUrl!);
          anchor.download = a.name;
          anchor.title = t("chat.openAttachment");
        }
        const icon = document.createElement("div");
        icon.className = "msg-attachment-icon";
        icon.textContent = fileIcon(a.mime);
        const text = document.createElement("div");
        text.className = "msg-attachment-text";
        const name = document.createElement("div");
        name.className = "msg-attachment-name";
        name.textContent = a.name;
        const meta = document.createElement("div");
        meta.className = "msg-attachment-meta";
        const ext = a.name.includes(".") ? a.name.split(".").pop()!.toUpperCase() : (a.mime.split("/")[1] || "file").toUpperCase();
        meta.textContent = a.size ? `${ext} · ${formatBytes(a.size)}` : ext;
        text.appendChild(name);
        text.appendChild(meta);
        chip.appendChild(icon);
        chip.appendChild(text);
        chipsWrap.appendChild(chip);
      }
    }
    row.appendChild(chipsWrap);
  }

  if (kind === "agent") {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const copyBtn = makeIconActionBtn("copy", "Copy");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.innerHTML = icons.check;
        copyBtn.classList.add("done");
        setTimeout(() => {
          copyBtn.innerHTML = icons.copy;
          copyBtn.classList.remove("done");
        }, 1200);
      });
    });
    actions.appendChild(copyBtn);

    const speakBtn = makeIconActionBtn("volume", "Read aloud");
    speakBtn.addEventListener("click", async () => {
      const stopUi = () => {
        speakBtn.classList.remove("speaking");
        speakBtn.innerHTML = icons.volume;
      };
      if (speakBtn.classList.contains("speaking")) {
        stopSpeaking();
        stopUi();
        return;
      }
      speakBtn.classList.add("speaking");
      speakBtn.innerHTML = icons.volumeOff;
      try {
        // speak() uses the studio voice when "High-quality voice" is on in
        // settings, and falls back to the device voice otherwise (or on error).
        await speak(content, { onEnd: stopUi });
      } catch {
        stopUi();
        showToast("Could not read this message aloud.");
      }
    });
    actions.appendChild(speakBtn);

    const upBtn = makeIconActionBtn("thumbUp", "Good response");
    const downBtn = makeIconActionBtn("thumbDown", "Bad response");
    upBtn.addEventListener("click", () => {
      const active = upBtn.classList.toggle("active");
      if (active) downBtn.classList.remove("active");
    });
    downBtn.addEventListener("click", () => {
      const active = downBtn.classList.toggle("active");
      if (active) upBtn.classList.remove("active");
    });
    actions.appendChild(upBtn);
    actions.appendChild(downBtn);

    row.appendChild(actions);
  }

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

// Only the most recent agent reply gets a "Try again" button — clicking it resends
// the last user message as a new turn (Mistral's conversation memory means this
// isn't a true delete-and-redo, but it's a fresh attempt at answering the same ask).
function attachRegenerateButton(row: HTMLDivElement) {
  if (lastAgentRow) {
    lastAgentRow.querySelector(".msg-action-regenerate")?.remove();
  }
  const actions = row.querySelector(".msg-actions");
  if (!actions) return;
  const btn = makeIconActionBtn("retry", "Try again");
  btn.classList.add("msg-action-regenerate");
  btn.addEventListener("click", () => regenerateLast());
  actions.appendChild(btn);
  lastAgentRow = row;
}

function renderMessages(messages: Message[]) {
  messagesEl.innerHTML = "";
  lastAgentRow = null;
  if (messages.length === 0) {
    messagesEl.appendChild(emptyState);
    emptyState.style.display = "flex";
    return;
  }
  let row: HTMLDivElement | null = null;
  for (const m of messages) {
    row = addMsgRow(m.role, m.content, m.attachments);
    if (m.role === "user") {
      lastUserText = m.content;
      lastUserAttachments = [];
    }
  }
  if (row && messages[messages.length - 1].role === "agent") {
    attachRegenerateButton(row);
  }
}

async function selectConversation(id: string) {
  setCurrentConversation(id);
  setComposerReadOnly(false);
  const convo = conversations.find((c) => c.id === id);
  chatTitle.textContent = convo?.title || t("chat.newChat");
  renderConvoList();
  messagesEl.innerHTML = "";
  const { messages } = await api.getMessages(id);
  renderMessages(messages);
  // Use toggleSidebar() rather than touching the class directly: it also syncs
  // the header "open sidebar" button, which otherwise stayed hidden on mobile
  // after switching chats, leaving no way to reopen the sidebar.
  if (window.innerWidth <= 720) toggleSidebar(true);
}

function startNewConversation() {
  setCurrentConversation(null);
  setComposerReadOnly(false);
  chatTitle.textContent = t("chat.newChat");
  lastUserText = "";
  lastUserAttachments = [];
  lastAgentRow = null;
  renderConvoList();
  renderMessages([]);
  chatInput.focus();
  // Use toggleSidebar() rather than touching the class directly: it also syncs
  // the header "open sidebar" button, which otherwise stayed hidden on mobile
  // after switching chats, leaving no way to reopen the sidebar.
  if (window.innerWidth <= 720) toggleSidebar(true);
}

function renderQuickActions() {
  quickActionsEl.innerHTML = "";
  for (const qa of QUICK_ACTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-action-btn";
    btn.textContent = t(qa.labelKey);
    btn.addEventListener("click", () => {
      if (qa.openLead) {
        openLeadModal(currentConversationId);
      } else if (qa.promptKey) {
        chatInput.value = t(qa.promptKey);
        chatForm.requestSubmit();
      }
    });
    quickActionsEl.appendChild(btn);
  }
}

document.addEventListener("langchange", renderQuickActions);

function renderAttachmentChips() {
  attachmentChips.innerHTML = "";
  pendingAttachments.forEach((att, idx) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = `${fileIcon(att.mime)} ${att.name} (${formatBytes(att.size)})`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.innerHTML = icons.close;
    remove.addEventListener("click", () => {
      pendingAttachments.splice(idx, 1);
      renderAttachmentChips();
    });
    chip.appendChild(label);
    chip.appendChild(remove);
    attachmentChips.appendChild(chip);
  });
}

async function handleFiles(files: FileList | File[]) {
  setHint("");
  for (const file of Array.from(files)) {
    if (file.size > MAX_FILE_BYTES) {
      setHint(`"${file.name}" is over the ${formatBytes(MAX_FILE_BYTES)} limit and was skipped.`, true);
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      pendingAttachments.push({ name: file.name, mime: file.type || "application/octet-stream", size: file.size, dataUrl });
    } catch {
      setHint(`Could not read "${file.name}".`, true);
    }
  }
  renderAttachmentChips();
}

async function performSend(text: string, attachments: (Attachment & { dataUrl: string })[], showUserBubble: boolean) {
  if (showUserBubble) {
    const attachmentsForDisplay: Attachment[] = attachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size }));
    addMsgRow("user", text, attachmentsForDisplay);
  }

  lastUserText = text;
  lastUserAttachments = attachments;

  sendBtn.disabled = true;
  setHint("");

  const thinking = addMsgRow("thinking", "…");

  try {
    const result = await api.sendMessage({
      conversation_id: currentConversationId || undefined,
      message: text,
      attachments,
    });
    thinking.remove();
    const agentRow = addMsgRow("agent", result.reply || "(empty response)", result.attachments || []);
    attachRegenerateButton(agentRow);

    const isNewConvo = !currentConversationId;
    setCurrentConversation(result.conversation_id);
    chatTitle.textContent = result.title;

    if (isNewConvo) {
      await loadConversations();
    } else {
      const convo = conversations.find((c) => c.id === currentConversationId);
      if (convo) {
        convo.title = result.title;
        convo.updated_at = new Date().toISOString();
        conversations = [convo, ...conversations.filter((c) => c.id !== convo.id)];
      }
    }
    renderConvoList();
  } catch (err) {
    thinking.remove();
    const message = err instanceof ApiError ? err.message : "Network error. Please try again.";
    addMsgRow("error", message);
  } finally {
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text && pendingAttachments.length === 0) return;

  const outgoing = pendingAttachments;
  pendingAttachments = [];
  renderAttachmentChips();
  chatInput.value = "";
  chatInput.style.height = "auto";

  await performSend(text, outgoing, true);
}

async function regenerateLast() {
  if (!lastUserText && lastUserAttachments.length === 0) return;
  await performSend(lastUserText, lastUserAttachments, false);
}

const sidebarBackdrop = document.createElement("div");
sidebarBackdrop.className = "sidebar-backdrop";
document.body.appendChild(sidebarBackdrop);

function syncSidebarBackdrop() {
  const open = window.innerWidth <= 720 && !sidebar.classList.contains("collapsed");
  sidebarBackdrop.classList.toggle("visible", open);
}

function syncSidebarOpenBtn() {
  // On desktop the collapsed rail stays visible with its own toggle button, so
  // showing this header button too would put two "open/close sidebar" icons on
  // screen at once. It's only needed on mobile, where collapsing hides the rail
  // entirely (see the <=720 media query) and leaves no other way back in.
  const isMobile = window.innerWidth <= 720;
  sidebarOpenBtn.style.display = isMobile && sidebar.classList.contains("collapsed") ? "inline-flex" : "none";
}

function toggleSidebar(collapsed?: boolean) {
  sidebar.classList.toggle("collapsed", collapsed ?? !sidebar.classList.contains("collapsed"));
  syncSidebarBackdrop();
  syncSidebarOpenBtn();
}

function closeSidebarSearch() {
  sidebarSearchRow.style.display = "none";
  sidebarSearchInput.value = "";
  filterConvoList("");
}

function filterConvoList(query: string) {
  const q = query.trim().toLowerCase();
  convoList.querySelectorAll<HTMLDivElement>(".convo-item").forEach((item) => {
    const title = item.querySelector(".convo-title")?.textContent?.toLowerCase() || "";
    item.style.display = !q || title.includes(q) ? "flex" : "none";
  });
}

// Voice input: transcribes speech straight into the composer while the mic button
// is held active. Falls back gracefully (hidden button) where unsupported.
const SpeechRecognitionCtor: any =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let recognizer: any = null;
let recording = false;

function setupMic() {
  if (!SpeechRecognitionCtor) {
    micBtn.style.display = "none";
    return;
  }
  recognizer = new SpeechRecognitionCtor();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.onresult = (event: any) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    chatInput.value = transcript;
    chatInput.style.height = "auto";
    chatInput.style.height = `${chatInput.scrollHeight}px`;
  };
  recognizer.onend = () => {
    recording = false;
    micBtn.classList.remove("recording");
  };
  recognizer.onerror = () => {
    recording = false;
    micBtn.classList.remove("recording");
  };
  // Hold-to-speak: recording runs only while the button is held down, and stops
  // as soon as it's released (or the pointer/focus leaves the button).
  const startRecording = () => {
    if (recording) return;
    try {
      recognizer.start();
      recording = true;
      micBtn.classList.add("recording");
      micBtn.title = t("composer.listening");
    } catch {
      // already started / permission denied — ignore, button state stays off
    }
  };

  const stopRecording = () => {
    micBtn.title = t("composer.holdToSpeak");
    if (!recording) return;
    recording = false;
    micBtn.classList.remove("recording");
    try {
      recognizer.stop();
    } catch {
      // nothing to stop
    }
    chatInput.focus();
  };

  micBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    micBtn.setPointerCapture?.(e.pointerId);
    startRecording();
  });
  micBtn.addEventListener("pointerup", stopRecording);
  micBtn.addEventListener("pointercancel", stopRecording);
  micBtn.addEventListener("pointerleave", stopRecording);
  micBtn.addEventListener("blur", stopRecording);
  micBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  // Keyboard equivalent: hold Space/Enter while the mic button is focused.
  micBtn.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      startRecording();
    }
  });
  micBtn.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") stopRecording();
  });
  // A click never starts recording anymore, so a stray tap does nothing.
  micBtn.addEventListener("click", (e) => e.preventDefault());
}

function closeAttachMenu() {
  attachMenu.style.display = "none";
}

export function initChatView(user: User) {
  currentUser = user;
  mountStaticIcons();
  sidebarUsername.textContent = user.display_name || user.username;
  applyAvatar(userAvatar, user);

  // On small screens the sidebar overlays the chat, so it should start closed.
  // Use toggleSidebar() rather than touching the class directly: it also syncs
  // the header "open sidebar" button, which otherwise stayed hidden on mobile
  // after switching chats, leaving no way to reopen the sidebar.
  if (window.innerWidth <= 720) toggleSidebar(true);
  syncSidebarOpenBtn();

  // If the studio voice isn't available, tell the user why the device voice spoke.
  document.addEventListener("tts-fallback", (e) => {
    const detail = (e as CustomEvent).detail || {};
    const status = detail.status;
    if (status === 501) setHint(t("settings.hqVoiceNotConfigured"), true);
    else if (detail.timeout) setHint(t("settings.hqVoiceSlow"), true);
    else setHint(t("settings.hqVoiceError"), true);
  });

  newChatBtn.addEventListener("click", startNewConversation);
  sidebarToggle.addEventListener("click", () => toggleSidebar());
  sidebarOpenBtn.addEventListener("click", () => toggleSidebar(false));
  sidebarBackdrop.addEventListener("click", () => toggleSidebar(true));
  window.addEventListener("resize", () => {
    if (window.innerWidth > 720) sidebar.classList.remove("collapsed");
    syncSidebarBackdrop();
    syncSidebarOpenBtn();
  });

  sidebarSearchBtn.addEventListener("click", () => {
    toggleSidebar(false);
    sidebarSearchRow.style.display = "flex";
    sidebarSearchInput.focus();
  });
  sidebarSearchClose.addEventListener("click", closeSidebarSearch);
  sidebarSearchInput.addEventListener("input", () => filterConvoList(sidebarSearchInput.value));

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggleSidebar(false);
      sidebarSearchRow.style.display = "flex";
      sidebarSearchInput.focus();
    } else if (e.key === ".") {
      e.preventDefault();
      toggleSidebar();
    }
  });

  attachBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    attachMenu.style.display = attachMenu.style.display === "none" ? "flex" : "none";
  });
  attachMenuFiles.addEventListener("click", () => {
    closeAttachMenu();
    fileInput.click();
  });
  attachMenuTools.addEventListener("click", () => {
    closeAttachMenu();
    document.getElementById("tools-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  document.addEventListener("click", (e) => {
    if (!attachMenu.contains(e.target as Node) && e.target !== attachBtn) closeAttachMenu();
  });

  setupMic();

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${chatInput.scrollHeight}px`;
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    // Read-only shared chats hide the composer, but guard the submit path too so a
    // stray Enter keypress can't fire a request the server would reject.
    if (currentChatReadOnly) return;
    sendMessage();
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = "";
  });

  composerRow.addEventListener("dragover", (e) => {
    e.preventDefault();
    composerRow.classList.add("drag-over");
  });
  composerRow.addEventListener("dragleave", () => composerRow.classList.remove("drag-over"));
  composerRow.addEventListener("drop", (e) => {
    e.preventDefault();
    composerRow.classList.remove("drag-over");
    if (e.dataTransfer?.files.length) handleFiles(e.dataTransfer.files);
  });

  renderQuickActions();
  loadConversations();
  renderMessages([]);
  handleConvoLinkFromHash();
}

export function updateChatUser(user: User) {
  currentUser = user;
  sidebarUsername.textContent = user.display_name || user.username;
  applyAvatar(userAvatar, user);
}

// Lets other views (e.g. Settings → Privacy → "Delete all chats") refresh the
// sidebar conversation list after they've changed conversations behind our back.
export async function refreshConversations() {
  setCurrentConversation(null);
  renderMessages([]);
  chatTitle.textContent = t("chat.newChat");
  await loadConversations();
}

export function resetChatView() {
  conversations = [];
  setCurrentConversation(null);
  pendingAttachments = [];
  lastUserText = "";
  lastUserAttachments = [];
  lastAgentRow = null;
  convoList.innerHTML = "";
  messagesEl.innerHTML = "";
  renderAttachmentChips();
}
