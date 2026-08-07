import { API_BASE, authHeaders } from "../api";

/**
 * Background removal via the Paul Worker (Cloudflare Images segment=foreground).
 * No ~80MB model download in the browser — processing runs on api.afmarbre.com.
 */
export async function removeBackground(
  file: File,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  onProgress?.(10);

  const form = new FormData();
  form.append("file", file);

  const resp = await fetch(`${API_BASE}/api/bg-remove`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
    credentials: "include",
  });

  onProgress?.(70);

  if (!resp.ok) {
    let message = `Background removal failed (${resp.status})`;
    try {
      const data = await resp.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const blob = await resp.blob();
  onProgress?.(100);
  if (!blob.size) throw new Error("Empty response from background removal.");
  return blob;
}
