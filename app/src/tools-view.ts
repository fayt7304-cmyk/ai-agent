import { API_BASE, authHeaders } from "./api";
import { extractText } from "./lib/ocr";
import { removeBackground } from "./lib/bgRemove";
import { loadImage, convertImage, extensionFor, type ImageMimeType } from "./lib/convert";
import { markdownToDocxBlob } from "./lib/markdownToDocx";
import { initUnitConverter } from "./lib/uconvert";
import { initMaterialEstimate } from "./lib/material";
import { initCalculator } from "./lib/calculator";
import { initWeather, loadWeather } from "./lib/weather";
import { t } from "./lib/i18n";
import { icons } from "./lib/icons";

const overlay = document.getElementById("tools-overlay") as HTMLDivElement;
const closeBtn = document.getElementById("tools-close-btn") as HTMLButtonElement;
const backBtn = document.getElementById("tools-back-btn") as HTMLButtonElement;
const title = document.getElementById("tools-title") as HTMLHeadingElement;
const menu = document.getElementById("tools-menu") as HTMLDivElement;
const tabs = document.getElementById("tools-tabs") as HTMLDivElement;

const panes: Record<string, HTMLDivElement> = {
  convert: document.getElementById("tool-convert") as HTMLDivElement,
  bgremove: document.getElementById("tool-bgremove") as HTMLDivElement,
  ocr: document.getElementById("tool-ocr") as HTMLDivElement,
  pdf2word: document.getElementById("tool-pdf2word") as HTMLDivElement,
  docx: document.getElementById("tool-docx") as HTMLDivElement,
  uconvert: document.getElementById("tool-uconvert") as HTMLDivElement,
};

const toolLabelKeys: Record<string, string> = {
  convert: "tools.convert.label",
  bgremove: "tools.bgremove.label",
  ocr: "tools.ocr.label",
  pdf2word: "tools.pdf2word.label",
  docx: "tools.docx.label",
  uconvert: "tools.uconvert.label",
};

function close() {
  overlay.style.display = "none";
  // Reset back to the tool picker for next time it's opened.
  showMenu();
}

// Home screen: a simple grid of tool tiles, nothing else visible.
function showMenu() {
  title.textContent = t("tools.title");
  backBtn.style.display = "none";
  menu.style.display = "flex";
  Object.values(panes).forEach((el) => (el.style.display = "none"));
}

// Opens one tool full-width, with a back arrow to return to the grid.
const toolTitles: Record<string, string> = {
  convert: "Convert image",
  bgremove: "Remove background",
  ocr: "Image to text",
  pdf2word: "PDF to Word",
  docx: "Text to Word",
  uconvert: "Site tools",
};

function openUconvertSub(sub: string) {
  const uconvertTabs = document.getElementById("uconvert-tabs");
  const btn = uconvertTabs?.querySelector<HTMLButtonElement>(`[data-uconvert-tab="${sub}"]`);
  btn?.click();
}

function switchTab(tab: string, uconvertSub?: string) {
  title.textContent = toolTitles[tab] || t(toolLabelKeys[tab]) || t("tools.title");
  backBtn.style.display = "inline-flex";
  menu.style.display = "none";
  tabs.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("active", b.dataset.toolTab === tab));
  Object.entries(panes).forEach(([key, el]) => {
    el.style.display = key === tab ? "flex" : "none";
  });
  if (tab === "uconvert" && uconvertSub) {
    // Defer so pane is visible before tab click
    requestAnimationFrame(() => openUconvertSub(uconvertSub));
  }
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

function setStatus(el: HTMLElement | null, message: string, kind: "idle" | "working" | "ok" | "error" = "idle") {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("working", "ok", "error");
  if (kind === "working") el.classList.add("working");
  if (kind === "ok") el.classList.add("ok");
  if (kind === "error") el.classList.add("error");
}

function validateFileSize(file: File, maxBytes: number, label: string): string | null {
  if (file.size > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    return `${label} is too large (max ${mb} MB).`;
  }
  return null;
}

/** Put text into the chat composer and close tools (everyday “send to Paul”). */
function sendTextToPaul(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  window.dispatchEvent(new CustomEvent("paul:tools-insert", { detail: { text: trimmed } }));
  close();
}

// A drag/drop + click-to-choose file zone shared by all the file-based tools.
function setupDropzone(dropId: string, fileId: string, onFile: (file: File) => void) {
  const drop = byId<HTMLDivElement>(dropId);
  const input = byId<HTMLInputElement>(fileId);
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    if (e.dataTransfer?.files.length) onFile(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => {
    if (input.files?.length) onFile(input.files[0]);
  });
}

// ---------- Format converter ----------
function initConvertTool() {
  let loadedImage: HTMLImageElement | null = null;

  const status = () => document.getElementById("convert-status");

  setupDropzone("convert-drop", "convert-file", async (file) => {
    const err = validateFileSize(file, MAX_IMAGE_BYTES, "Image");
    if (err) {
      setStatus(status(), err, "error");
      return;
    }
    setStatus(status(), "Loading…", "working");
    try {
      const img = await loadImage(file);
      loadedImage = img;
      byId<HTMLImageElement>("convert-img").src = img.src;
      byId("convert-preview").style.display = "block";
      byId("convert-controls").style.display = "flex";
      byId("convert-drop-text").textContent = file.name;
      setStatus(status(), "Ready — choose a format and download.", "ok");
    } catch (e: any) {
      setStatus(status(), e?.message || "Could not read image.", "error");
    }
  });

  byId<HTMLButtonElement>("convert-download").addEventListener("click", async () => {
    if (!loadedImage) return;
    const btn = byId<HTMLButtonElement>("convert-download");
    btn.disabled = true;
    setStatus(status(), "Converting…", "working");
    try {
      const format = byId<HTMLSelectElement>("convert-format").value as ImageMimeType;
      const blob = await convertImage(loadedImage, format);
      downloadBlob(blob, "converted." + extensionFor(format));
      setStatus(status(), "Downloaded.", "ok");
    } catch (e: any) {
      setStatus(status(), e?.message || "Convert failed.", "error");
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Background remover ----------
function initBgRemoveTool() {
  let currentFile: File | null = null;
  let resultBlob: Blob | null = null;

  setupDropzone("bg-drop", "bg-file", (file) => {
    const err = validateFileSize(file, MAX_IMAGE_BYTES, "Image");
    if (err) {
      setStatus(byId("bg-status"), err, "error");
      return;
    }
    currentFile = file;
    resultBlob = null;
    const url = URL.createObjectURL(file);
    byId<HTMLImageElement>("bg-img").src = url;
    const before = document.getElementById("bg-img-before") as HTMLImageElement | null;
    if (before) {
      before.src = url;
      before.style.display = "block";
    }
    const afterWrap = document.getElementById("bg-after-wrap");
    if (afterWrap) afterWrap.style.display = "none";
    byId("bg-preview").style.display = "block";
    byId("bg-controls").style.display = "flex";
    byId("bg-drop-text").textContent = file.name;
    byId("bg-download").style.display = "none";
    setStatus(byId("bg-status"), "Ready — remove background when you like.", "ok");
  });

  byId<HTMLButtonElement>("bg-remove").addEventListener("click", async () => {
    if (!currentFile) return;
    const status = byId<HTMLDivElement>("bg-status");
    const btn = byId<HTMLButtonElement>("bg-remove");
    btn.disabled = true;
    setStatus(status, t("tool.bg.loadingModel") || "Working…", "working");

    try {
      resultBlob = await removeBackground(currentFile, (pct) => {
        setStatus(status, (t("tool.bg.processing") || "Processing… {pct}%").replace("{pct}", String(pct)), "working");
      });
      const outUrl = URL.createObjectURL(resultBlob);
      byId<HTMLImageElement>("bg-img").src = outUrl;
      const after = document.getElementById("bg-img-after") as HTMLImageElement | null;
      if (after) after.src = outUrl;
      const afterWrap = document.getElementById("bg-after-wrap");
      if (afterWrap) afterWrap.style.display = "block";
      byId("bg-download").style.display = "inline-block";
      setStatus(status, t("tool.bg.done") || "Done — download your PNG.", "ok");
    } catch (err: any) {
      setStatus(status, (t("tool.bg.error") || "Error: ") + (err?.message || "failed"), "error");
    } finally {
      btn.disabled = false;
    }
  });

  byId<HTMLButtonElement>("bg-download").addEventListener("click", () => {
    if (resultBlob) downloadBlob(resultBlob, "background-removed.png");
  });
}

// ---------- Image to text (OCR) ----------
function initOcrTool() {
  let currentFile: File | null = null;

  setupDropzone("ocr-drop", "ocr-file", (file) => {
    const err = validateFileSize(file, MAX_IMAGE_BYTES, "Image");
    if (err) {
      setStatus(byId("ocr-status"), err, "error");
      return;
    }
    currentFile = file;
    byId<HTMLImageElement>("ocr-img").src = URL.createObjectURL(file);
    byId("ocr-preview").style.display = "block";
    byId("ocr-controls").style.display = "flex";
    byId("ocr-drop-text").textContent = file.name;
    byId<HTMLTextAreaElement>("ocr-output").style.display = "none";
    byId("ocr-output-controls").style.display = "none";
    setStatus(byId("ocr-status"), "Ready — extract text when you like.", "ok");
  });

  byId<HTMLButtonElement>("ocr-run").addEventListener("click", async () => {
    if (!currentFile) return;
    const status = byId<HTMLDivElement>("ocr-status");
    const btn = byId<HTMLButtonElement>("ocr-run");
    btn.disabled = true;
    status.classList.add("working");
    status.textContent = t("tool.ocr.reading");

    try {
      const text = await extractText(currentFile);
      const output = byId<HTMLTextAreaElement>("ocr-output");
      output.value = text || "(no text detected)";
      output.style.display = "block";
      byId("ocr-output-controls").style.display = "flex";
      setStatus(status, t("tool.ocr.done") || "Done — copy, download, or send to Paul.", "ok");
    } catch (err: any) {
      setStatus(status, (t("tool.ocr.error") || "Error: ") + (err?.message || t("tool.ocr.failed") || "failed"), "error");
    } finally {
      btn.disabled = false;
    }
  });

  byId<HTMLButtonElement>("ocr-copy").addEventListener("click", () => {
    const btn = byId<HTMLButtonElement>("ocr-copy");
    navigator.clipboard.writeText(byId<HTMLTextAreaElement>("ocr-output").value).then(() => {
      const original = btn.textContent;
      btn.textContent = t("tool.ocr.copied");
      setTimeout(() => (btn.textContent = original), 1500);
    });
  });

  byId<HTMLButtonElement>("ocr-download-txt").addEventListener("click", () => {
    const text = byId<HTMLTextAreaElement>("ocr-output").value;
    downloadBlob(new Blob([text], { type: "text/plain" }), "extracted-text.txt");
  });

  byId<HTMLButtonElement>("ocr-download-docx").addEventListener("click", async () => {
    const text = byId<HTMLTextAreaElement>("ocr-output").value;
    const blob = await markdownToDocxBlob(text);
    downloadBlob(blob, "extracted-text.docx");
  });

  document.getElementById("ocr-send-paul")?.addEventListener("click", () => {
    sendTextToPaul(byId<HTMLTextAreaElement>("ocr-output").value);
  });
}

// ---------- PDF to Word ----------
function initPdf2WordTool() {
  let currentFile: File | null = null;

  setupDropzone("pdf-drop", "pdf-file", (file) => {
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setStatus(byId("pdf-status"), "Please choose a PDF file.", "error");
      return;
    }
    const err = validateFileSize(file, MAX_PDF_BYTES, "PDF");
    if (err) {
      setStatus(byId("pdf-status"), err, "error");
      return;
    }
    currentFile = file;
    byId("pdf-drop-text").textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
    byId("pdf-controls").style.display = "flex";
    setStatus(byId("pdf-status"), "Ready — convert when you like.", "ok");
  });

  byId<HTMLButtonElement>("pdf-run").addEventListener("click", async () => {
    if (!currentFile) return;
    const status = byId<HTMLDivElement>("pdf-status");
    const btn = byId<HTMLButtonElement>("pdf-run");
    btn.disabled = true;
    setStatus(status, t("tool.pdf.reading") || "Reading PDF…", "working");

    try {
      const markdown = await extractText(currentFile);
      if (!markdown?.trim()) {
        setStatus(status, "No text could be extracted from this PDF.", "error");
        return;
      }
      setStatus(status, t("tool.pdf.building") || "Building Word document…", "working");
      const blob = await markdownToDocxBlob(markdown);
      const name = currentFile.name.replace(/\.pdf$/i, "") + ".docx";
      downloadBlob(blob, name);
      setStatus(status, (t("tool.pdf.done") || "Downloaded") + ` — ${name}`, "ok");
    } catch (err: any) {
      setStatus(status, (t("tool.pdf.error") || "Error: ") + (err?.message || t("tool.pdf.failed") || "failed"), "error");
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Markdown to docx ----------
function initDocxTool() {
  const input = byId<HTMLTextAreaElement>("docx-input");
  const runBtn = byId<HTMLButtonElement>("docx-run-btn");
  const status = byId<HTMLDivElement>("docx-status");

  runBtn.addEventListener("click", async () => {
    if (!input.value.trim()) {
      setStatus(status, t("tool.docx.pasteFirst") || "Paste some text first.", "error");
      return;
    }
    setStatus(status, t("tool.docx.building") || "Building…", "working");
    runBtn.disabled = true;
    try {
      const titleEl = document.getElementById("docx-title") as HTMLInputElement | null;
      const title = titleEl?.value.trim();
      const body = title ? `# ${title}

${input.value}` : input.value;
      const blob = await markdownToDocxBlob(body);
      const fname = (title || "document").replace(/[^\w\-]+/g, "_").slice(0, 40) + ".docx";
      downloadBlob(blob, fname);
      setStatus(status, (t("tool.docx.downloaded") || "Downloaded") + ` — ${fname}`, "ok");
    } catch (e: any) {
      setStatus(status, e?.message || t("tool.docx.exportFailed") || "Export failed.", "error");
    } finally {
      runBtn.disabled = false;
    }
  });

  document.getElementById("docx-send-paul")?.addEventListener("click", () => {
    sendTextToPaul(input.value);
  });
}

// ---------- Universal Converter (unit/currency convert, material estimate, calculator, weather) ----------
function initUniversalConverter() {
  const uconvertTabs = byId<HTMLDivElement>("uconvert-tabs");
  const subPanels: Record<string, HTMLElement> = {
    convert: byId("convert-panel"),
    material: byId("material-panel"),
    calculator: byId("calculator-panel"),
    weather: byId("weather-panel"),
  };
  let weatherLoaded = false;

  uconvertTabs.querySelectorAll<HTMLButtonElement>("[data-uconvert-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      uconvertTabs.querySelectorAll("[data-uconvert-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const key = btn.dataset.uconvertTab!;
      Object.values(subPanels).forEach((el) => (el.style.display = "none"));
      subPanels[key].style.display = "block";

      if (key === "weather" && !weatherLoaded) {
        weatherLoaded = true;
        loadWeather();
      }
    });
  });

  initUnitConverter();
  initMaterialEstimate();
  initCalculator();
  initWeather();
}

export function initToolsView() {
  const toolsBtn = document.getElementById("tools-btn") as HTMLButtonElement;
  toolsBtn.addEventListener("click", () => {
    overlay.style.display = "flex";
    showMenu();
    void refreshToolsHealth();
  });
  closeBtn.addEventListener("click", close);
  backBtn.addEventListener("click", showMenu);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  menu.querySelectorAll<HTMLButtonElement>(".tool-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.toolTab!;
      const sub = btn.dataset.uconvertOpen;
      switchTab(tab, sub);
    });
  });

  // T4 — SVG icons on tool cards (quiet studio)
  const toolIconSvg: Record<string, string> = {
    image: (icons as any).image || icons.paperclip,
    scissors: (icons as any).scissors || icons.close,
    text: icons.copy,
    doc: icons.paperclip,
    ruler: (icons as any).ruler || icons.tools,
    slab: (icons as any).slab || icons.tools,
    calc: (icons as any).calc || icons.tools,
    weather: (icons as any).weather || icons.tools,
  };
  // Prefer dedicated shapes where icons exist
  menu.querySelectorAll<HTMLElement>("[data-tool-icon]").forEach((el) => {
    const key = el.dataset.toolIcon || "";
    const svg = toolIconSvg[key] || icons.tools;
    el.innerHTML = svg;
  });

  // T3 — Send result text to Paul
  document.querySelectorAll<HTMLButtonElement>(".tool-copy-paul").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.copyFrom;
      const el = id ? document.getElementById(id) : null;
      const text = (el?.textContent || "").trim();
      if (!text || text === "—") return;
      sendTextToPaul(text);
    });
  });
  tabs.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.toolTab!));
  });

  initConvertTool();
  initBgRemoveTool();
  initOcrTool();
  initPdf2WordTool();
  initDocxTool();
  initUniversalConverter();
}


async function refreshToolsHealth() {
  const el = document.getElementById("tools-health");
  if (!el) return;
  try {
    const resp = await fetch(`${API_BASE}/api/tools/health`, {
      headers: authHeaders(),
      credentials: "include",
    });
    if (!resp.ok) {
      el.style.display = "none";
      return;
    }
    const data: any = await resp.json();
    const problems: string[] = [];
    if (data?.ocr && !data.ocr.ok) problems.push(data.ocr.detail || "OCR unavailable");
    if (data?.bg_remove && !data.bg_remove.ok) problems.push(data.bg_remove.detail || "Background removal unavailable");
    if (problems.length) {
      el.textContent = "Some tools need setup: " + problems.join(" · ");
      el.classList.add("tools-health-warn");
      el.style.display = "";
    } else {
      el.textContent = "File tools ready (convert is on-device; OCR & background removal OK).";
      el.classList.remove("tools-health-warn");
      el.classList.add("tools-health-ok");
      el.style.display = "";
      setTimeout(() => {
        if (el.classList.contains("tools-health-ok")) el.style.display = "none";
      }, 4000);
    }
  } catch {
    el.style.display = "none";
  }
}

