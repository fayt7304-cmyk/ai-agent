import { api, ApiError, type Conversation, type Message, type Attachment, type User } from "./api";
import { readFileAsDataUrl, formatBytes, fileIcon, MAX_FILE_BYTES } from "./files";
import { renderMarkdown } from "./lib/markdown";
import { openLeadModal } from "./lead-view";
import { applyAvatar } from "./lib/avatar";
import { t } from "./lib/i18n";
import { icons } from "./lib/icons";

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
}

let currentUser: User;
let conversations: Conversation[] = [];
let currentConversationId: string | null = null;
let pendingAttachments: (Attachment & { dataUrl: string })[] = [];
let lastUserText = "";
let lastUserAttachments: (Attachment & { dataUrl: string })[] = [];
let lastAgentRow: HTMLDivElement | null = null;

function setHint(text: string, isError = false) {
  composerHint.textContent = text;
  composerHint.classList.toggle("error", isError);
}

function renderConvoList() {
  convoList.innerHTML = "";
  for (const c of conversations) {
    const item = document.createElement("div");
    item.className = "convo-item" + (c.id === currentConversationId ? " active" : "");
    const title = document.createElement("span");
    title.className = "convo-title";
    title.textContent = c.title;
    const del = document.createElement("button");
    del.className = "convo-delete";
    del.textContent = "✕";
    del.title = "Delete conversation";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${c.title}"?`)) return;
      await api.deleteConversation(c.id);
      conversations = conversations.filter((x) => x.id !== c.id);
      if (currentConversationId === c.id) {
        currentConversationId = null;
        renderMessages([]);
        chatTitle.textContent = t("chat.newChat");
      }
      renderConvoList();
    });
    item.appendChild(title);
    item.appendChild(del);
    item.addEventListener("click", () => selectConversation(c.id));
    convoList.appendChild(item);
  }
}

async function loadConversations() {
  const { conversations: list } = await api.listConversations();
  conversations = list;
  renderConvoList();
}

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
        const chip = document.createElement("div");
        chip.className = "msg-attachment-chip";
        chip.textContent = `${fileIcon(a.mime)} ${a.name}`;
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
    speakBtn.addEventListener("click", () => {
      if (!("speechSynthesis" in window)) return;
      if (speakBtn.classList.contains("speaking")) {
        window.speechSynthesis.cancel();
        speakBtn.classList.remove("speaking");
        speakBtn.innerHTML = icons.volume;
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(content.replace(/[#*`_>-]/g, ""));
      utter.onend = () => {
        speakBtn.classList.remove("speaking");
        speakBtn.innerHTML = icons.volume;
      };
      speakBtn.classList.add("speaking");
      speakBtn.innerHTML = icons.volumeOff;
      window.speechSynthesis.speak(utter);
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
  currentConversationId = id;
  const convo = conversations.find((c) => c.id === id);
  chatTitle.textContent = convo?.title || t("chat.newChat");
  renderConvoList();
  messagesEl.innerHTML = "";
  const { messages } = await api.getMessages(id);
  renderMessages(messages);
  if (window.innerWidth <= 720) sidebar.classList.add("collapsed");
  syncSidebarBackdrop();
}

function startNewConversation() {
  currentConversationId = null;
  chatTitle.textContent = t("chat.newChat");
  lastUserText = "";
  lastUserAttachments = [];
  lastAgentRow = null;
  renderConvoList();
  renderMessages([]);
  chatInput.focus();
  if (window.innerWidth <= 720) sidebar.classList.add("collapsed");
  syncSidebarBackdrop();
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
    remove.textContent = "✕";
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
    currentConversationId = result.conversation_id;
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
  sidebarOpenBtn.style.display = sidebar.classList.contains("collapsed") ? "inline-flex" : "none";
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
  micBtn.addEventListener("click", () => {
    if (recording) {
      recognizer.stop();
      recording = false;
      micBtn.classList.remove("recording");
    } else {
      try {
        recognizer.start();
        recording = true;
        micBtn.classList.add("recording");
      } catch {
        // already started / permission denied — ignore, button state stays off
      }
    }
  });
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
  if (window.innerWidth <= 720) sidebar.classList.add("collapsed");
  syncSidebarBackdrop();
  syncSidebarOpenBtn();

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
}

export function updateChatUser(user: User) {
  currentUser = user;
  sidebarUsername.textContent = user.display_name || user.username;
  applyAvatar(userAvatar, user);
}

// Lets other views (e.g. Settings → Privacy → "Delete all chats") refresh the
// sidebar conversation list after they've changed conversations behind our back.
export async function refreshConversations() {
  currentConversationId = null;
  renderMessages([]);
  chatTitle.textContent = t("chat.newChat");
  await loadConversations();
}

export function resetChatView() {
  conversations = [];
  currentConversationId = null;
  pendingAttachments = [];
  lastUserText = "";
  lastUserAttachments = [];
  lastAgentRow = null;
  convoList.innerHTML = "";
  messagesEl.innerHTML = "";
  renderAttachmentChips();
}
