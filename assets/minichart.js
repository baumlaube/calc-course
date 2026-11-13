/* MiniChart – einfache Säulen-, Kreis- und Liniendiagramme als SVG für den Calc-Kurs.
   Lizenz: CC BY-SA 4.0 · herrseibert.de · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const PALETTE = ["var(--ch1)", "var(--ch2)", "var(--ch3)", "var(--ch4)", "var(--ch5)", "var(--ch6)", "var(--ch7)"];
  const fmt = (x) => (typeof x === "number" ? x.toLocaleString("de-DE", { maximumFractionDigits: 1 }) : "–");

  function el(name, attrs, parent, text) {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  /** Schöne Achsenschritte: 1, 2, 5, 10, 20, 50 … */
  function niceStep(range, ticks) {
    const raw = range / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  /**
   * render(container, { type: "bar"|"pie"|"line", labels, values, title, yTitle, yMin, unit })
   * Mehrere Linien: { type: "line", labels, series: [{ name, values }], … } – mit Legende.
   */
  function render(container, o) {
    container.innerHTML = "";
    const W = 420, H = 270;
    const series = o.series || [{ name: "", values: o.values }];
    const label = o.series
      ? o.series.map((s) => `${s.name}: ` + o.labels.map((l, i) => `${l} ${fmt(s.values[i])}`).join(", ")).join("; ")
      : o.labels.map((l, i) => `${l} ${fmt(o.values[i])}`).join(", ");
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "mchart", role: "img", "aria-label": `${o.title}: ${label}` }, container);
    el("text", { x: W / 2, y: 20, class: "mc-title", "text-anchor": "middle" }, svg, o.title);

    if (o.type === "pie") {
      const total = o.values.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
      const cx = 135, cy = 148, r = 95;
      let a0 = -Math.PI / 2;
      o.values.forEach((v, i) => {
        const frac = Math.max(v, 0) / total;
        const a1 = a0 + frac * 2 * Math.PI;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (a) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
        if (frac >= 0.999) el("circle", { cx, cy, r, fill: PALETTE[i % PALETTE.length] }, svg);
        else if (frac > 0) el("path", { d: `M${cx},${cy} L${p(a0)} A${r},${r} 0 ${large} 1 ${p(a1)} Z`, fill: PALETTE[i % PALETTE.length], class: "mc-slice" }, svg);
        if (frac > 0.04) {
          const am = (a0 + a1) / 2;
          el("text", { x: cx + r * 0.62 * Math.cos(am), y: cy + r * 0.62 * Math.sin(am) + 5, "text-anchor": "middle", class: "mc-pct" }, svg, Math.round(frac * 100) + " %");
        }
        a0 = a1;
      });
      o.labels.forEach((l, i) => {
        const y = 70 + i * 26;
        el("rect", { x: 262, y: y - 12, width: 14, height: 14, rx: 3, fill: PALETTE[i % PALETTE.length] }, svg);
        el("text", { x: 284, y, class: "mc-lbl" }, svg, l);
      });
      return;
    }

    const L = 52, R = 14, T = o.series ? 58 : 38, B = 44;
    const pw = W - L - R, ph = H - T - B;
    const all = series.flatMap((s) => s.values.filter((v) => typeof v === "number"));
    const max = Math.max(...all, 0);
    const yMin = o.yMin !== undefined ? o.yMin : Math.min(0, ...all);
    if (o.series) {   // Legende unter dem Titel
      let x = L;
      o.series.forEach((s, k) => {
        el("rect", { x, y: 30, width: 14, height: 4, rx: 2, fill: PALETTE[k % PALETTE.length] }, svg);
        el("text", { x: x + 19, y: 36, class: "mc-lbl" }, svg, s.name);
        x += 30 + s.name.length * 7.5;
      });
    }
    const step = niceStep(max - yMin, 5);
    const yMax = Math.ceil(max / step) * step || step;
    const y = (v) => T + ph - ((Math.max(v, yMin) - yMin) / (yMax - yMin)) * ph;
    for (let t = yMin; t <= yMax + 1e-9; t += step) {
      el("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), class: "mc-grid" }, svg);
      el("text", { x: L - 8, y: y(t) + 4, "text-anchor": "end", class: "mc-tick" }, svg, fmt(t));
    }
    el("line", { x1: L, x2: L, y1: T, y2: T + ph, class: "mc-axis" }, svg);
    el("line", { x1: L, x2: W - R, y1: T + ph, y2: T + ph, class: "mc-axis" }, svg);
    if (o.yTitle) el("text", { x: 14, y: T + ph / 2, transform: `rotate(-90 14 ${T + ph / 2})`, "text-anchor": "middle", class: "mc-tick" }, svg, o.yTitle);

    const n = o.labels.length, slot = pw / n;
    const xc = (i) => L + slot * (i + 0.5);
    o.labels.forEach((l, i) => el("text", { x: xc(i), y: T + ph + 18, "text-anchor": "middle", class: "mc-lbl" }, svg, l));

    if (o.type === "bar") {
      const bw = Math.min(slot * 0.62, 56);
      o.values.forEach((v, i) => {
        const top = y(v);
        el("rect", { x: xc(i) - bw / 2, y: top, width: bw, height: Math.max(T + ph - top, 0), rx: 3, fill: PALETTE[0], class: "mc-bar" }, svg);
        if (o.valueLabels !== false) el("text", { x: xc(i), y: top - 6, "text-anchor": "middle", class: "mc-val" }, svg, fmt(v));
      });
    } else {
      series.forEach((s, k) => {
        const col = PALETTE[k % PALETTE.length];
        const ok = s.values.map((v) => typeof v === "number");
        if (ok.every(Boolean)) {
          const pts = s.values.map((v, i) => `${xc(i)},${y(v)}`).join(" ");
          el("polyline", { points: pts, fill: "none", stroke: col, "stroke-width": 3, "stroke-linejoin": "round" }, svg);
        }
        s.values.forEach((v, i) => {
          if (!ok[i]) return;
          el("circle", { cx: xc(i), cy: y(v), r: 5, fill: col, stroke: "var(--surface)", "stroke-width": 2 }, svg);
          if (o.valueLabels !== false && !o.series) el("text", { x: xc(i), y: y(v) - 11, "text-anchor": "middle", class: "mc-val" }, svg, fmt(v));
        });
      });
    }
  }

  window.MiniChart = { render };
})();
