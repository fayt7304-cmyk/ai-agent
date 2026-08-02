import { removeBackground as imglyRemoveBackground } from "@imgly/background-removal";

export async function removeBackground(
  file: File,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  const blob = await imglyRemoveBackground(file, {
    model: "isnet",
    output: { format: "image/png", quality: 1 },
    progress: (_key: string, current: number, total: number) => {
      if (onProgress && total) onProgress(Math.round((current / total) * 100));
    },
  });
  return featherEdges(blob);
}

// Softens jagged alpha-channel edges left by the segmentation model,
// giving noticeably cleaner-looking cutouts.
async function featherEdges(blob: Blob): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL.createObjectURL(blob);
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];

  const blurred = new Uint8ClampedArray(w * h);
  const radius = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            sum += alpha[ny * w + nx];
            count++;
          }
        }
      }
      blurred[y * w + x] = sum / count;
    }
  }

  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = blurred[i];
  ctx.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))), "image/png");
  });
}
