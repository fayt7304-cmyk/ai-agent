import { extractText } from "./lib/ocr";
import { removeBackground } from "./lib/bgRemove";
import { loadImage, convertImage, extensionFor, type ImageMimeType } from "./lib/convert";
import { markdownToDocxBlob } from "./lib/markdownToDocx";

const overlay = document.getElementById("tools-overlay") as HTMLDivElement;
const closeBtn = document.getElementById("tools-close-btn") as HTMLButtonElement;
const tabs = document.getElementById("tools-tabs") as HTMLDivElement;

const panes: Record<string, HTMLDivElement> = {
  ocr: document.getElementById("tool-ocr") as HTMLDivElement,
  bgremove: document.getElementById("tool-bgremove") as HTMLDivElement,
  convert: document.getElementById("tool-convert") as HTMLDivElement,
  docx: document.getElementById("tool-docx") as HTMLDivElement,
};

function close() {
  overlay.style.display = "none";
}

function switchTab(tab: string) {
  tabs.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("active", b.dataset.toolTab === tab));
  Object.entries(panes).forEach(([key, el]) => {
    el.style.display = key === tab ? "block" : "none";
  });
}

function initOcr() {
  const fileInput = document.getElementById("ocr-file") as HTMLInputElement;
  const runBtn = document.getElementById("ocr-run-btn") as HTMLButtonElement;
  const status = document.getElementById("ocr-status") as HTMLDivElement;
  const output = document.getElementById("ocr-output") as HTMLTextAreaElement;
  const copyBtn = document.getElementById("ocr-copy-btn") as HTMLButtonElement;

  runBtn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      status.textContent = "Choose an image or PDF first.";
      return;
    }
    status.textContent = "Extracting text…";
    runBtn.disabled = true;
    copyBtn.style.display = "none";
    try {
      const text = await extractText(file);
      output.value = text;
      status.textContent = text ? "Done." : "No text found.";
      if (text) copyBtn.style.display = "inline-block";
    } catch (e: any) {
      status.textContent = e?.message || "OCR failed. Check that the OCR service is reachable.";
    } finally {
      runBtn.disabled = false;
    }
  });

  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(output.value).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy text"), 1500);
    });
  });
}

function initBgRemove() {
  const fileInput = document.getElementById("bgremove-file") as HTMLInputElement;
  const runBtn = document.getElementById("bgremove-run-btn") as HTMLButtonElement;
  const status = document.getElementById("bgremove-status") as HTMLDivElement;
  const preview = document.getElementById("bgremove-preview") as HTMLDivElement;
  const download = document.getElementById("bgremove-download") as HTMLAnchorElement;

  runBtn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      status.textContent = "Choose an image first.";
      return;
    }
    status.textContent = "Removing background… (this runs in your browser and can take a moment)";
    runBtn.disabled = true;
    download.style.display = "none";
    preview.innerHTML = "";
    try {
      const blob = await removeBackground(file, (pct) => {
        status.textContent = `Removing background… ${pct}%`;
      });
      const url = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.src = url;
      img.className = "tool-preview-img";
      preview.appendChild(img);
      download.href = url;
      download.download = file.name.replace(/\.[^.]+$/, "") + "-cutout.png";
      download.style.display = "inline-block";
      status.textContent = "Done.";
    } catch (e: any) {
      status.textContent = e?.message || "Background removal failed.";
    } finally {
      runBtn.disabled = false;
    }
  });
}

function initConvert() {
  const fileInput = document.getElementById("convert-file") as HTMLInputElement;
  const runBtn = document.getElementById("convert-run-btn") as HTMLButtonElement;
  const status = document.getElementById("convert-status") as HTMLDivElement;
  const download = document.getElementById("convert-download") as HTMLAnchorElement;
  const formatSeg = document.getElementById("convert-format") as HTMLDivElement;
  let format: ImageMimeType = "image/png";

  formatSeg.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      format = btn.dataset.format as ImageMimeType;
      formatSeg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  runBtn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      status.textContent = "Choose an image first.";
      return;
    }
    status.textContent = "Converting…";
    runBtn.disabled = true;
    download.style.display = "none";
    try {
      const img = await loadImage(file);
      const blob = await convertImage(img, format);
      const url = URL.createObjectURL(blob);
      download.href = url;
      download.download = file.name.replace(/\.[^.]+$/, "") + "." + extensionFor(format);
      download.style.display = "inline-block";
      status.textContent = "Done.";
    } catch (e: any) {
      status.textContent = e?.message || "Conversion failed.";
    } finally {
      runBtn.disabled = false;
    }
  });
}

function initDocx() {
  const input = document.getElementById("docx-input") as HTMLTextAreaElement;
  const runBtn = document.getElementById("docx-run-btn") as HTMLButtonElement;
  const status = document.getElementById("docx-status") as HTMLDivElement;

  runBtn.addEventListener("click", async () => {
    if (!input.value.trim()) {
      status.textContent = "Paste some markdown first.";
      return;
    }
    status.textContent = "Building document…";
    runBtn.disabled = true;
    try {
      const blob = await markdownToDocxBlob(input.value);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "document.docx";
      a.click();
      status.textContent = "Downloaded.";
    } catch (e: any) {
      status.textContent = e?.message || "Export failed.";
    } finally {
      runBtn.disabled = false;
    }
  });
}

export function initToolsView() {
  const toolsBtn = document.getElementById("tools-btn") as HTMLButtonElement;
  toolsBtn.addEventListener("click", () => {
    overlay.style.display = "flex";
  });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  tabs.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.toolTab!));
  });

  initOcr();
  initBgRemove();
  initConvert();
  initDocx();
}
