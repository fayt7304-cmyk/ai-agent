import { API_BASE, authHeaders } from "../api";

/**
 * OCR via the main Paul Worker at API_BASE (default https://api.afmarbre.com).
 * Uses Mistral Document AI on the server (same MISTRAL_API_KEY as chat).
 */
export async function extractText(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);

  const resp = await fetch(`${API_BASE}/api/ocr`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
    credentials: "include",
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    /* ignore */
  }

  if (!resp.ok) {
    throw new Error(data?.error || `OCR request failed (${resp.status})`);
  }

  return typeof data?.markdown === "string" ? data.markdown : "";
}
