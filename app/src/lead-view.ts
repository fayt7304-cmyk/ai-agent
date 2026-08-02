import { api, ApiError } from "./api";
import { formatBytes, readImageAsPhotoDataUrl } from "./files";

const overlay = document.getElementById("lead-overlay") as HTMLDivElement;
const closeBtn = document.getElementById("lead-close-btn") as HTMLButtonElement;
const cancelBtn = document.getElementById("lead-cancel-btn") as HTMLButtonElement;
const submitBtn = document.getElementById("lead-submit-btn") as HTMLButtonElement;
const nameInput = document.getElementById("lead-name") as HTMLInputElement;
const phoneInput = document.getElementById("lead-phone") as HTMLInputElement;
const emailInput = document.getElementById("lead-email") as HTMLInputElement;
const messageInput = document.getElementById("lead-message") as HTMLTextAreaElement;
const photoInput = document.getElementById("lead-photo") as HTMLInputElement;
const photoBtn = document.getElementById("lead-photo-btn") as HTMLButtonElement;
const photoPreview = document.getElementById("lead-photo-preview") as HTMLDivElement;
const photoImg = document.getElementById("lead-photo-img") as HTMLImageElement;
const photoHint = document.getElementById("lead-photo-hint") as HTMLSpanElement;
const photoRemoveBtn = document.getElementById("lead-photo-remove") as HTMLButtonElement;
const leadError = document.getElementById("lead-error") as HTMLDivElement;
const leadSuccess = document.getElementById("lead-success") as HTMLDivElement;

let currentConversationId: string | null = null;
// Compressed base64 data URL of the chosen photo, actually sent to the Worker
// (and on to the team's inbox as an email attachment) — not just metadata.
let photoDataUrl: string | null = null;

function clearPhoto() {
  photoDataUrl = null;
  photoInput.value = "";
  photoImg.src = "";
  photoHint.textContent = "";
  photoPreview.style.display = "none";
  photoBtn.style.display = "flex";
}

function close() {
  overlay.style.display = "none";
  leadError.textContent = "";
  leadSuccess.textContent = "";
  nameInput.value = "";
  phoneInput.value = "";
  emailInput.value = "";
  messageInput.value = "";
  clearPhoto();
}

export function initLeadView() {
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  photoBtn.addEventListener("click", () => photoInput.click());
  photoRemoveBtn.addEventListener("click", clearPhoto);

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    leadError.textContent = "";
    if (!file.type.startsWith("image/")) {
      leadError.textContent = "Please choose an image file.";
      photoInput.value = "";
      return;
    }
    try {
      photoDataUrl = await readImageAsPhotoDataUrl(file);
      photoImg.src = photoDataUrl;
      const approxBytes = Math.round((photoDataUrl.length * 3) / 4);
      photoHint.textContent = `${file.name} (${formatBytes(approxBytes)})`;
      photoBtn.style.display = "none";
      photoPreview.style.display = "flex";
    } catch {
      leadError.textContent = "Could not read that photo. Please try another.";
      clearPhoto();
    }
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
        has_photo: !!photoDataUrl,
        photo_data_url: photoDataUrl || undefined,
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
