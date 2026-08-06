import { fmt } from "./uconvert";
import { t } from "./i18n";

export function initMaterialEstimate() {
  const widthInput = document.getElementById("mat-width") as HTMLInputElement;
  const widthUnit = document.getElementById("mat-width-unit") as HTMLSelectElement;
  const lengthInput = document.getElementById("mat-length") as HTMLInputElement;
  const lengthUnit = document.getElementById("mat-length-unit") as HTMLSelectElement;
  const wasteInput = document.getElementById("mat-waste") as HTMLInputElement;
  const result = document.getElementById("mat-result") as HTMLDivElement;

  function update() {
    const w = parseFloat(widthInput.value) || 0;
    const l = parseFloat(lengthInput.value) || 0;
    const waste = parseFloat(wasteInput.value) || 0;

    const wM = widthUnit.value === "ft" ? w * 0.3048 : w;
    const lM = lengthUnit.value === "ft" ? l * 0.3048 : l;
    const areaM2 = wM * lM;
    const withWaste = areaM2 * (1 + waste / 100);

    // Isolate numbers so RTL UIs do not reorder "12 m² (13.2 …)" into a mess.
    const text = t("material.areaResult")
      .replace("{area}", fmt(areaM2, 2))
      .replace("{withWaste}", fmt(withWaste, 2));
    result.setAttribute("dir", "auto");
    result.style.unicodeBidi = "isolate";
    result.textContent = text;
  }

  [widthInput, widthUnit, lengthInput, lengthUnit, wasteInput].forEach((el) => {
    el.addEventListener("input", update);
    el.addEventListener("change", update);
  });
  document.addEventListener("langchange", update);
  update();
}
