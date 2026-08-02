import { api, ApiError, type Conversation, type Message, type Attachment, type User } from "./api";
import { readFileAsDataUrl, formatBytes, fileIcon, MAX_FILE_BYTES } from "./files";

const sidebar = document.getElementById("sidebar") as HTMLDivElement;
const sidebarToggle = document.getElementById("sidebar-toggle") as HTMLButtonElement;
const convoList = document.getElementById("convo-list") as HTMLDivElement;
const newChatBtn = document.getElementById("new-chat-btn") as HTMLButtonElement;
const chatTitle = document.getElementById("chat-title") as HTMLDivElement;
const messagesEl = document.getElementById("messages") as HTMLDivElement;
const emptyState = document.getElementById("empty-state") as HTMLDivElement;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const attachBtn = document.getElementById("attach-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const attachmentChips = document.getElementById("attachment-chips") as HTMLDivElement;
const composerRow = document.querySelector(".composer-row") as HTMLDivElement;
const composerHint = document.getElementById("composer-hint") as HTMLDivElement;
const sidebarUsername = document.getElementById("sidebar-username") as HTMLDivElement;
const userAvatar = document.getElementById("user-avatar") as HTMLSpanElement;

let currentUser: User;
let conversations: Conversation[] = [];
let currentConversationId: string | null = null;
let pendingAttachments: (Attachment & { dataUrl: string })[] = [];

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
        chatTitle.textContent = "New chat";
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

function addMsgRow(kind: "user" | "agent" | "error" | "thinking", content: string, attachments: Attachment[] = []) {
  emptyState.style.display = "none";
  const row = document.createElement("div");
  row.className = `msg-row ${kind === "thinking" ? "agent thinking" : kind}`;

  const bubble = document.createElement("div");
  bubble.className = "msg";
  bubble.textContent = content;
  row.appendChild(bubble);

  if (attachments.length) {
    const chipsWrap = document.createElement("div");
    chipsWrap.className = "msg-attachments";
    for (const a of attachments) {
      const chip = document.createElement("div");
      chip.className = "msg-attachment-chip";
      chip.textContent = `${fileIcon(a.mime)} ${a.name}`;
      chipsWrap.appendChild(chip);
    }
    row.appendChild(chipsWrap);
  }

  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function renderMessages(messages: Message[]) {
  messagesEl.innerHTML = "";
  if (messages.length === 0) {
    messagesEl.appendChild(emptyState);
    emptyState.style.display = "flex";
    return;
  }
  for (const m of messages) {
    addMsgRow(m.role, m.content, m.attachments);
  }
}

async function selectConversation(id: string) {
  currentConversationId = id;
  const convo = conversations.find((c) => c.id === id);
  chatTitle.textContent = convo?.title || "Chat";
  renderConvoList();
  messagesEl.innerHTML = "";
  const { messages } = await api.getMessages(id);
  renderMessages(messages);
  if (window.innerWidth <= 720) sidebar.classList.add("collapsed");
}

function startNewConversation() {
  currentConversationId = null;
  chatTitle.textContent = "New chat";
  renderConvoList();
  renderMessages([]);
  chatInput.focus();
  if (window.innerWidth <= 720) sidebar.classList.add("collapsed");
}

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

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text && pendingAttachments.length === 0) return;

  const attachmentsForDisplay: Attachment[] = pendingAttachments.map((a) => ({ name: a.name, mime: a.mime, size: a.size }));
  addMsgRow("user", text, attachmentsForDisplay);

  const outgoing = pendingAttachments;
  pendingAttachments = [];
  renderAttachmentChips();
  chatInput.value = "";
  chatInput.style.height = "auto";
  sendBtn.disabled = true;
  setHint("");

  const thinking = addMsgRow("thinking", "…");

  try {
    const result = await api.sendMessage({
      conversation_id: currentConversationId || undefined,
      message: text,
      attachments: outgoing,
    });
    thinking.remove();
    addMsgRow("agent", result.reply || "(empty response)");

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

export function initChatView(user: User) {
  currentUser = user;
  sidebarUsername.textContent = user.username;
  userAvatar.textContent = user.username.slice(0, 2).toUpperCase();

  newChatBtn.addEventListener("click", startNewConversation);
  sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("collapsed"));

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

  attachBtn.addEventListener("click", () => fileInput.click());
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

  loadConversations();
  renderMessages([]);
}

export function updateChatUser(user: User) {
  currentUser = user;
}

export function resetChatView() {
  conversations = [];
  currentConversationId = null;
  pendingAttachments = [];
  convoList.innerHTML = "";
  messagesEl.innerHTML = "";
  renderAttachmentChips();
}
