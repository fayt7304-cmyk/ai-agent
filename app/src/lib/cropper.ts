declare const Cropper: any;

const overlay = document.getElementById("crop-overlay") as HTMLDivElement;
const cropImg = document.getElementById("crop-image") as HTMLImageElement;
const cancelBtn = document.getElementById("crop-cancel-btn") as HTMLButtonElement;
const confirmBtn = document.getElementById("crop-confirm-btn") as HTMLButtonElement;

// Mobile-friendly zoom controls. Pinch-to-zoom works out of the box on touch
// devices, but a thumb-sized +/- pair and a slider make the cropper usable
// one-handed, which pinching inside a small modal never really is.
const zoomSlider = document.getElementById("crop-zoom-slider") as HTMLInputElement | null;
const zoomInBtn = document.getElementById("crop-zoom-in-btn") as HTMLButtonElement | null;
const zoomOutBtn = document.getElementById("crop-zoom-out-btn") as HTMLButtonElement | null;
const resetBtn = document.getElementById("crop-reset-btn") as HTMLButtonElement | null;

let cropper: any = null;
let currentResolve: ((value: string | null) => void) | null = null;
/** Zoom ratio at which the image exactly fits the crop box; the slider is relative to it. */
let baseRatio = 0;

function currentFactor(): number {
  if (!cropper || !baseRatio) return 1;
  const data = cropper.getImageData();
  if (!data?.width || !data?.naturalWidth) return 1;
  return data.width / data.naturalWidth / baseRatio;
}

function syncSlider() {
  if (!zoomSlider) return;
  const factor = currentFactor();
  zoomSlider.value = String(Math.min(4, Math.max(1, factor)));
}

function applyFactor(factor: number) {
  if (!cropper || !baseRatio) return;
  const clamped = Math.min(4, Math.max(1, factor));
  cropper.zoomTo(baseRatio * clamped);
  syncSlider();
}

export function showCropper(dataUrl: string, aspectRatio?: number): Promise<string | null> {
  return new Promise((resolve) => {
    currentResolve = resolve;
    cropImg.src = dataUrl;
    overlay.style.display = "flex";

    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    baseRatio = 0;

    cropper = new Cropper(cropImg, {
      aspectRatio: aspectRatio,
      viewMode: 1,
      autoCropArea: 1,
      responsive: true,
      restore: false,
      guides: true,
      center: true,
      highlight: false,
      // On phones, moving the picture under a fixed crop box is far easier than
      // dragging a small crop box around with a fingertip.
      dragMode: "move",
      cropBoxMovable: false,
      cropBoxResizable: false,
      toggleDragModeOnDblclick: false,
      ready() {
        const data = cropper.getImageData();
        baseRatio = data.width / data.naturalWidth;
        syncSlider();
      },
      zoom() {
        syncSlider();
      },
    });
  });
}

zoomSlider?.addEventListener("input", () => applyFactor(parseFloat(zoomSlider.value)));
zoomInBtn?.addEventListener("click", () => applyFactor(currentFactor() + 0.25));
zoomOutBtn?.addEventListener("click", () => applyFactor(currentFactor() - 0.25));
resetBtn?.addEventListener("click", () => {
  if (!cropper) return;
  cropper.reset();
  syncSlider();
});

function finish(result: string | null) {
  overlay.style.display = "none";
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  if (currentResolve) {
    currentResolve(result);
    currentResolve = null;
  }
}

cancelBtn.addEventListener("click", () => finish(null));

confirmBtn.addEventListener("click", () => {
  if (!cropper) return;
  const canvas = cropper.getCroppedCanvas({ maxWidth: 1600, maxHeight: 1600 });
  finish(canvas.toDataURL("image/jpeg", 0.85));
});
