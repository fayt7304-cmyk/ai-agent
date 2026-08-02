// Standard / scientific / graphing calculator, ported from the standalone
// Universal Converter tool's calculator module. Scoped to the calculator
// panel only so its buttons don't collide with the uconvert sub-tabs, which
// reuse the same `.calc-mode-tabs` class one level up.

let graphInitialized = false;
let cachedPlotGraph: (() => void) | null = null;
let cachedGraphView: HTMLElement | null = null;

// Called by theme.ts whenever the theme changes, since the graph reads its
// colors from CSS variables at draw time — a no-op if the calculator hasn't
// been initialized yet, or the graph view isn't the one currently visible.
export function redrawGraphIfVisible() {
  if (cachedGraphView && cachedGraphView.style.display !== "none" && cachedPlotGraph) {
    cachedPlotGraph();
  }
}

export function initCalculator() {
  const panel = document.getElementById("calculator-panel") as HTMLDivElement;

  // ---------- mode switching (Standard / Scientific / Graph) ----------
  const modeButtons = panel.querySelectorAll<HTMLButtonElement>("[data-calc-mode]");
  const views: Record<string, HTMLElement> = {
    standard: document.getElementById("calc-standard-view")!,
    scientific: document.getElementById("calc-scientific-view")!,
    graph: document.getElementById("calc-graph-view")!,
  };
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      Object.values(views).forEach((v) => (v.style.display = "none"));
      const mode = btn.dataset.calcMode!;
      views[mode].style.display = "block";
      if (mode === "graph") plotGraph();
    });
  });

  // ---------- standard calculator ----------
  const calcDisplay = document.getElementById("calc-display") as HTMLDivElement;
  let calcExpr = "";
  let calcJustEvaluated = false;

  panel.querySelectorAll<HTMLButtonElement>("[data-calc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.calc!;

      if (key === "clear") {
        calcExpr = "";
        calcDisplay.textContent = "0";
        return;
      }
      if (key === "sqrt") {
        const val = Math.sqrt(parseFloat(calcExpr) || 0);
        calcExpr = String(val);
        calcDisplay.textContent = calcExpr;
        calcJustEvaluated = true;
        return;
      }
      if (key === "square") {
        const val = Math.pow(parseFloat(calcExpr) || 0, 2);
        calcExpr = String(val);
        calcDisplay.textContent = calcExpr;
        calcJustEvaluated = true;
        return;
      }
      if (key === "=") {
        try {
          const result = Function('"use strict"; return (' + calcExpr + ")")();
          calcExpr = String(result);
          calcDisplay.textContent = calcExpr;
        } catch {
          calcDisplay.textContent = "Error";
          calcExpr = "";
        }
        calcJustEvaluated = true;
        return;
      }

      if (calcJustEvaluated && !isNaN(Number(key))) {
        calcExpr = "";
      }
      calcJustEvaluated = false;

      calcExpr += key;
      calcDisplay.textContent = calcExpr;
    });
  });

  // ---------- scientific calculator ----------
  const sciDisplay = document.getElementById("calc-sci-display") as HTMLDivElement;
  let sciExpr = "";

  function sciToJs(expr: string): string {
    return expr
      .replace(/\^/g, "**")
      .replace(/sin\(/g, "Math.sin(deg2rad(")
      .replace(/cos\(/g, "Math.cos(deg2rad(")
      .replace(/tan\(/g, "Math.tan(deg2rad(")
      .replace(/log\(/g, "Math.log10(")
      .replace(/ln\(/g, "Math.log(")
      .replace(/sqrt\(/g, "Math.sqrt(")
      .replace(/pi/g, "Math.PI")
      .replace(/(?<![a-zA-Z])e(?![a-zA-Z(])/g, "Math.E");
  }

  // sin/cos/tan need an extra closing paren because we wrapped their
  // argument in deg2rad(...) in addition to the function's own paren.
  function balanceTrigParens(rawExpr: string, jsExpr: string): string {
    const trigOpens = (rawExpr.match(/sin\(|cos\(|tan\(/g) || []).length;
    return jsExpr + ")".repeat(trigOpens);
  }

  panel.querySelectorAll<HTMLButtonElement>("[data-sci]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sci!;

      if (key === "clear") {
        sciExpr = "";
        sciDisplay.textContent = "0";
        return;
      }
      if (key === "del") {
        sciExpr = sciExpr.slice(0, -1);
        sciDisplay.textContent = sciExpr || "0";
        return;
      }
      if (key === "=") {
        try {
          const withHelper =
            "const deg2rad = (d) => d * Math.PI / 180; return (" + balanceTrigParens(sciExpr, sciToJs(sciExpr)) + ")";
          const result = Function('"use strict"; ' + withHelper)();
          sciExpr = String(result);
          sciDisplay.textContent = sciExpr;
        } catch {
          sciDisplay.textContent = "Error";
          sciExpr = "";
        }
        return;
      }

      sciExpr += key;
      sciDisplay.textContent = sciExpr;
    });
  });

  // ---------- graph ----------
  const graphExprInput = document.getElementById("graph-expr") as HTMLInputElement;
  const graphRangeSelect = document.getElementById("graph-range") as HTMLSelectElement;
  const graphPlotBtn = document.getElementById("graph-plot") as HTMLButtonElement;
  const graphStatus = document.getElementById("graph-status") as HTMLDivElement;
  const canvas = document.getElementById("graph-canvas") as HTMLCanvasElement;

  function exprToFunction(expr: string): (x: number) => number {
    const jsBody = expr
      .replace(/\^/g, "**")
      .replace(/sin\(/g, "Math.sin(")
      .replace(/cos\(/g, "Math.cos(")
      .replace(/tan\(/g, "Math.tan(")
      .replace(/sqrt\(/g, "Math.sqrt(")
      .replace(/abs\(/g, "Math.abs(")
      .replace(/log\(/g, "Math.log10(")
      .replace(/ln\(/g, "Math.log(")
      .replace(/pi/g, "Math.PI");
    return Function("x", '"use strict"; return (' + jsBody + ")") as (x: number) => number;
  }

  function plotGraph() {
    if (!canvas || canvas.offsetParent === null) return;
    graphStatus.textContent = "";
    const range = parseFloat(graphRangeSelect.value);
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    let fn: (x: number) => number;
    try {
      fn = exprToFunction(graphExprInput.value.trim());
      fn(0);
    } catch (err: any) {
      graphStatus.textContent = "Could not parse expression: " + err.message;
      return;
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const gridColor = rootStyle.getPropertyValue("--border").trim() || "#e3e1da";
    const axisColor = rootStyle.getPropertyValue("--text-secondary").trim() || "#6b6a64";
    const curveColor = rootStyle.getPropertyValue("--accent").trim() || "#185fa5";

    const xToPx = (x: number) => ((x + range) / (2 * range)) * w;
    const yToPx = (y: number, yRange: number) => h / 2 - (y / yRange) * (h / 2) * 0.9;

    const points: [number, number][] = [];
    let maxAbsY = 1;
    for (let px = 0; px <= w; px++) {
      const x = (px / w) * (2 * range) - range;
      let y: number;
      try {
        y = fn(x);
      } catch {
        y = NaN;
      }
      points.push([x, y]);
      if (isFinite(y)) maxAbsY = Math.max(maxAbsY, Math.abs(y));
    }
    const yRange = maxAbsY * 1.1;

    // gridlines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let gx = -range; gx <= range; gx += range / 5) {
      const px = xToPx(gx);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let gy = -yRange; gy <= yRange; gy += yRange / 5) {
      const py = yToPx(gy, yRange);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // axes
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xToPx(0), 0);
    ctx.lineTo(xToPx(0), h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, yToPx(0, yRange));
    ctx.lineTo(w, yToPx(0, yRange));
    ctx.stroke();

    // curve
    ctx.strokeStyle = curveColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    points.forEach(([x, y]) => {
      if (!isFinite(y)) {
        started = false;
        return;
      }
      const px = xToPx(x);
      const py = yToPx(y, yRange);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.stroke();
  }

  graphPlotBtn.addEventListener("click", plotGraph);
  graphRangeSelect.addEventListener("change", plotGraph);
  cachedPlotGraph = plotGraph;
  cachedGraphView = views.graph;
  if (!graphInitialized) {
    graphInitialized = true;
    window.addEventListener("resize", () => {
      if (views.graph.style.display !== "none") plotGraph();
    });
  }
}
