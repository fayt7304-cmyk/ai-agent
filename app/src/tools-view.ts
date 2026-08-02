import { extractText } from "./lib/ocr";
import { removeBackground } from "./lib/bgRemove";
import { loadImage, convertImage, extensionFor, type ImageMimeType } from "./lib/convert";
import { markdownToDocxBlob } from "./lib/markdownToDocx";
import { initUnitConverter } from "./lib/uconvert";
import { initMaterialEstimate } from "./lib/material";
import { initCalculator } from "./lib/calculator";
import { initWeather, loadWeather } from "./lib/weather";

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

const toolLabels: Record<string, string> = {
  convert: "Convert Image",
  bgremove: "Remove Background",
  ocr: "Image to Text",
  pdf2word: "PDF to Word",
  docx: "Text to Word",
  uconvert: "Converter & Calculator",
};

function close() {
  overlay.style.display = "none";
  // Reset back to the tool picker for next time it's opened.
  showMenu();
}

// Home screen: a simple grid of tool tiles, nothing else visible.
function showMenu() {
  title.textContent = "Tools";
  backBtn.style.display = "none";
  menu.style.display = "flex";
  Object.values(panes).forEach((el) => (el.style.display = "none"));
}

// Opens one tool full-width, with a back arrow to return to the grid.
function switchTab(tab: string) {
  title.textContent = toolLabels[tab] || "Tools";
  backBtn.style.display = "inline-flex";
  menu.style.display = "none";
  tabs.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("active", b.dataset.toolTab === tab));
  Object.entries(panes).forEach(([key, el]) => {
    el.style.display = key === tab ? "flex" : "none";
  });
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
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

  setupDropzone("convert-drop", "convert-file", async (file) => {
    const img = await loadImage(file);
    loadedImage = img;
    byId<HTMLImageElement>("convert-img").src = img.src;
    byId("convert-preview").style.display = "block";
    byId("convert-controls").style.display = "flex";
    byId("convert-drop-text").textContent = file.name;
  });

  byId<HTMLButtonElement>("convert-download").addEventListener("click", async () => {
    if (!loadedImage) return;
    const format = byId<HTMLSelectElement>("convert-format").value as ImageMimeType;
    const blob = await convertImage(loadedImage, format);
    downloadBlob(blob, "converted." + extensionFor(format));
  });
}

// ---------- Background remover ----------
function initBgRemoveTool() {
  let currentFile: File | null = null;
  let resultBlob: Blob | null = null;

  setupDropzone("bg-drop", "bg-file", (file) => {
    currentFile = file;
    resultBlob = null;
    byId<HTMLImageElement>("bg-img").src = URL.createObjectURL(file);
    byId("bg-preview").style.display = "block";
    byId("bg-controls").style.display = "flex";
    byId("bg-drop-text").textContent = file.name;
    byId("bg-download").style.display = "none";
    byId("bg-status").textContent = "";
  });

  byId<HTMLButtonElement>("bg-remove").addEventListener("click", async () => {
    if (!currentFile) return;
    const status = byId<HTMLDivElement>("bg-status");
    const btn = byId<HTMLButtonElement>("bg-remove");
    btn.disabled = true;
    status.classList.add("working");
    status.textContent = "Loading model…";

    try {
      resultBlob = await removeBackground(currentFile, (pct) => {
        status.textContent = `Processing… ${pct}%`;
      });
      byId<HTMLImageElement>("bg-img").src = URL.createObjectURL(resultBlob);
      byId("bg-download").style.display = "inline-block";
      status.textContent = "Done.";
      status.classList.remove("working");
    } catch (err: any) {
      status.textContent = "Something went wrong: " + err.message;
      status.classList.remove("working");
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
    currentFile = file;
    byId<HTMLImageElement>("ocr-img").src = URL.createObjectURL(file);
    byId("ocr-preview").style.display = "block";
    byId("ocr-controls").style.display = "flex";
    byId("ocr-drop-text").textContent = file.name;
    byId<HTMLTextAreaElement>("ocr-output").style.display = "none";
    byId("ocr-output-controls").style.display = "none";
    byId("ocr-status").textContent = "";
  });

  byId<HTMLButtonElement>("ocr-run").addEventListener("click", async () => {
    if (!currentFile) return;
    const status = byId<HTMLDivElement>("ocr-status");
    const btn = byId<HTMLButtonElement>("ocr-run");
    btn.disabled = true;
    status.classList.add("working");
    status.textContent = "Reading text…";

    try {
      const text = await extractText(currentFile);
      const output = byId<HTMLTextAreaElement>("ocr-output");
      output.value = text || "(no text detected)";
      output.style.display = "block";
      byId("ocr-output-controls").style.display = "flex";
      status.textContent = "Done.";
      status.classList.remove("working");
    } catch (err: any) {
      status.textContent = "Something went wrong: " + (err?.message || "OCR failed.");
      status.classList.remove("working");
    } finally {
      btn.disabled = false;
    }
  });

  byId<HTMLButtonElement>("ocr-copy").addEventListener("click", () => {
    const btn = byId<HTMLButtonElement>("ocr-copy");
    navigator.clipboard.writeText(byId<HTMLTextAreaElement>("ocr-output").value).then(() => {
      const original = btn.textContent;
      btn.textContent = "Copied!";
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
}

// ---------- PDF to Word ----------
function initPdf2WordTool() {
  let currentFile: File | null = null;

  setupDropzone("pdf-drop", "pdf-file", (file) => {
    currentFile = file;
    byId("pdf-drop-text").textContent = file.name;
    byId("pdf-controls").style.display = "flex";
    byId("pdf-status").textContent = "";
  });

  byId<HTMLButtonElement>("pdf-run").addEventListener("click", async () => {
    if (!currentFile) return;
    const status = byId<HTMLDivElement>("pdf-status");
    const btn = byId<HTMLButtonElement>("pdf-run");
    btn.disabled = true;
    status.classList.add("working");
    status.textContent = "Reading PDF and extracting text…";

    try {
      const markdown = await extractText(currentFile);
      status.textContent = "Building Word document…";
      const blob = await markdownToDocxBlob(markdown);
      downloadBlob(blob, currentFile.name.replace(/\.pdf$/i, "") + ".docx");
      status.textContent = "Done, download started.";
      status.classList.remove("working");
    } catch (err: any) {
      status.textContent = "Something went wrong: " + (err?.message || "Conversion failed.");
      status.classList.remove("working");
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
      status.textContent = "Paste some markdown first.";
      return;
    }
    status.textContent = "Building document…";
    runBtn.disabled = true;
    try {
      const blob = await markdownToDocxBlob(input.value);
      downloadBlob(blob, "document.docx");
      status.textContent = "Downloaded.";
    } catch (e: any) {
      status.textContent = e?.message || "Export failed.";
    } finally {
      runBtn.disabled = false;
    }
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
  });
  closeBtn.addEventListener("click", close);
  backBtn.addEventListener("click", showMenu);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  menu.querySelectorAll<HTMLButtonElement>(".tool-card").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.toolTab!));
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
