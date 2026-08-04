
declare const Cropper: any;

const overlay = document.getElementById("crop-overlay") as HTMLDivElement;
const cropImg = document.getElementById("crop-image") as HTMLImageElement;
const cancelBtn = document.getElementById("crop-cancel-btn") as HTMLButtonElement;
const confirmBtn = document.getElementById("crop-confirm-btn") as HTMLButtonElement;

let cropper: any = null;
let currentResolve: ((value: string | null) => void) | null = null;

export function showCropper(dataUrl: string, aspectRatio?: number): Promise<string | null> {
  return new Promise((resolve) => {
    currentResolve = resolve;
    cropImg.src = dataUrl;
    overlay.style.display = "flex";

    if (cropper) {
      cropper.destroy();
    }

    cropper = new Cropper(cropImg, {
      aspectRatio: aspectRatio,
      viewMode: 1,
      autoCropArea: 1,
      responsive: true,
      restore: false,
      guides: true,
      center: true,
      highlight: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
    });
  });
}

cancelBtn.addEventListener("click", () => {
  overlay.style.display = "none";
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
  if (currentResolve) {
    currentResolve(null);
    currentResolve = null;
  }
});

confirmBtn.addEventListener("click", () => {
  if (!cropper) return;

  const canvas = cropper.getCroppedCanvas({
    maxWidth: 1600,
    maxHeight: 1600,
  });

  const result = canvas.toDataURL("image/jpeg", 0.85);
  overlay.style.display = "none";
  cropper.destroy();
  cropper = null;

  if (currentResolve) {
    currentResolve(result);
    currentResolve = null;
  }
});
