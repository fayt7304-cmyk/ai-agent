// Points to your deployed Worker (see worker/ folder and the README
// for deployment steps). Update this after you deploy.
export const OCR_ENDPOINT = "https://file-toolkit-ocr.fayt7304.workers.dev/api/ocr";

export async function extractText(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);

  const resp = await fetch(OCR_ENDPOINT, { method: "POST", body: form });
  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data?.error || `OCR request failed (${resp.status})`);
  }

  return data.markdown || "";
}
