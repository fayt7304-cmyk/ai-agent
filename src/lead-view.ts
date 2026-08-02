import { api, ApiError } from "./api";
import { formatBytes } from "./files";

const overlay = document.getElementById("lead-overlay") as HTMLDivElement;
const closeBtn = document.getElementById("lead-close-btn") as HTMLButtonElement;
const cancelBtn = document.getElementById("lead-cancel-btn") as HTMLButtonElement;
const submitBtn = document.getElementById("lead-submit-btn") as HTMLButtonElement;
const nameInput = document.getElementById("lead-name") as HTMLInputElement;
const phoneInput = document.getElementById("lead-phone") as HTMLInputElement;
const emailInput = document.getElementById("lead-email") as HTMLInputElement;
const messageInput = document.getElementById("lead-message") as HTMLTextAreaElement;
const photoInput = document.getElementById("lead-photo") as HTMLInputElement;
const photoHint = document.getElementById("lead-photo-hint") as HTMLDivElement;
const leadError = document.getElementById("lead-error") as HTMLDivElement;
const leadSuccess = document.getElementById("lead-success") as HTMLDivElement;

let currentConversationId: string | null = null;

// The Worker only stores lead metadata (not file bytes) — same pattern as chat
// attachments. The photo itself never leaves the browser; this just lets your
// team know a photo exists so they can ask the customer to resend it directly,
// or you can extend this later to actually upload it (e.g. to R2).
function close() {
  overlay.style.display = "none";
  leadError.textContent = "";
  leadSuccess.textContent = "";
  nameInput.value = "";
  phoneInput.value = "";
  emailInput.value = "";
  messageInput.value = "";
  photoInput.value = "";
  photoHint.textContent = "";
}

export function initLeadView() {
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  photoInput.addEventListener("change", () => {
    const file = photoInput.files?.[0];
    photoHint.textContent = file ? `${file.name} (${formatBytes(file.size)})` : "";
  });

  submitBtn.addEventListener("click", async () => {
    leadError.textContent = "";
    leadSuccess.textContent = "";
    submitBtn.disabled = true;
    try {
      await api.submitLead({
        conversation_id: currentConversationId || undefined,
        name: nameInput.value.trim() || undefined,
        phone: phoneInput.value.trim() || undefined,
        email: emailInput.value.trim() || undefined,
        message: messageInput.value.trim() || undefined,
        has_photo: !!photoInput.files?.length,
      });
      leadSuccess.textContent = "Thanks — we'll be in touch shortly.";
      setTimeout(close, 1500);
    } catch (err) {
      leadError.textContent = err instanceof ApiError ? err.message : "Could not send your request. Please try again.";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

export function openLeadModal(conversationId: string | null, prefillMessage?: string) {
  currentConversationId = conversationId;
  leadError.textContent = "";
  leadSuccess.textContent = "";
  messageInput.value = prefillMessage || "";
  overlay.style.display = "flex";
  nameInput.focus();
}
