// Replace with your deployed Worker URL (see README).
export const CHAT_ENDPOINT = "https://mistral-agent-chat.YOUR-SUBDOMAIN.workers.dev/api/chat";

const messagesEl = document.getElementById("messages") as HTMLDivElement;
const formEl = document.getElementById("chat-form") as HTMLFormElement;
const inputEl = document.getElementById("chat-input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;

let conversationId: string | undefined;

function addBubble(text: string, kind: "user" | "agent" | "error" | "thinking"): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

// Grow the textarea as the user types, up to the CSS max-height.
inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = `${inputEl.scrollHeight}px`;
});

// Enter sends, Shift+Enter makes a newline.
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    formEl.requestSubmit();
  }
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  addBubble(text, "user");
  inputEl.value = "";
  inputEl.style.height = "auto";
  sendBtn.disabled = true;
  const thinking = addBubble("…", "thinking");

  try {
    const resp = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, conversation_id: conversationId }),
    });

    const data = (await resp.json()) as { reply?: string; conversation_id?: string; error?: string };
    thinking.remove();

    if (!resp.ok || data.error) {
      addBubble(data.error || "Something went wrong.", "error");
      return;
    }

    conversationId = data.conversation_id;
    addBubble(data.reply || "(empty response)", "agent");
  } catch (err: any) {
    thinking.remove();
    addBubble(err?.message || "Network error", "error");
  } finally {
    sendBtn.disabled = false;
    inputEl.focus();
  }
});
