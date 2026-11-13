/* Regeln – bedingte Formatierung für MiniCalc, mit einem Dialog wie in LibreOffice Calc
   (Format → Bedingt → Bedingung …). Die erste passende Bedingung gewinnt – wie in Calc.
   Lizenz: CC BY-SA 4.0 · herrseibert.de · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";
  const T = (x) => (window.T ? window.T(x) : x);
  const OPS = [
    ["=", "gleich"], ["<", "kleiner als"], [">", "größer als"], ["<=", "kleiner oder gleich"],
    [">=", "größer oder gleich"], ["<>", "ungleich"], ["between", "zwischen"],
  ];
  const STYLES = [["bad", "Schlecht"], ["good", "Gut"], ["neutral", "Neutral"]];
  const CLASSES = ["cf-good", "cf-bad", "cf-neutral"];

  // „30“ → Zahl, „"nein"“ → Text (wie im Calc-Dialog: Text in Anführungszeichen)
  function parseVal(s) {
    s = String(s ?? "").trim();
    const m = /^"(.*)"$/.exec(s);
    if (m) return m[1];
    if (/^\$?[A-Za-z]\$?\d+$/.test(s)) return { ref: s.toUpperCase() };   // Zelle wie $B$2
    if (/^-?\d+(?:,\d+)?\s*%$/.test(s)) return parseFloat(s.replace(",", ".")) / 100;
    if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return parseFloat(s.replace(",", "."));
    return s === "" ? null : { bad: s };   // Text ohne Anführungszeichen
  }
  function cmp(v, op, a, b) {
    if (v === null || v === undefined || v === "" || a === null || (a && a.bad !== undefined)) return false;
    if (typeof v === "string" || typeof a === "string") {
      const x = String(v).toLowerCase(), y = String(a).toLowerCase();
      return op === "=" ? x === y : op === "<>" ? x !== y : false;
    }
    switch (op) {
      case "=": return v === a;
      case "<>": return v !== a;
      case "<": return v < a;
      case ">": return v > a;
      case "<=": return v <= a;
      case ">=": return v >= a;
      case "between": return typeof b === "number" && v >= Math.min(a, b) && v <= Math.max(a, b);
      default: return false;
    }
  }
  /** Welche Vorlage bekommt der Wert v? (erste passende Regel) */
  function styleFor(v, rules) {
    for (const r of rules) if (cmp(v, r.op, r.a, r.b)) return r.style;
    return null;
  }
  /** Färbt die Zellen einer MiniCalc nach den Regeln. Gibt {Adresse: Vorlage} zurück. */
  function apply(calc, cells, rules) {
    const out = {};
    const first = /^([A-Z])(\d+)$/.exec(cells[0] || "A1");
    // Zellbezug als Wert: relativ zur ersten Zelle des Bereichs – ohne $ wandert er mit, wie in Calc
    const val = (x, a) => {
      if (!x || x.ref === undefined) return x;
      const m = /^([A-Z])(\d+)$/.exec(a);
      const f = MiniCalc.shiftFormula("=" + x.ref, +m[2] - +first[2], m[1].charCodeAt(0) - first[1].charCodeAt(0));
      return calc.get(f.slice(1).replace(/\$/g, ""));
    };
    for (const a of cells) {
      const td = calc.tds[a];
      const st = styleFor(calc.get(a), rules.map((r) => Object.assign({}, r, { a: val(r.a, a), b: val(r.b, a) })));
      out[a] = st;
      if (!td) continue;
      CLASSES.forEach((c) => td.classList.remove(c));
      if (st) td.classList.add("cf-" + st);
    }
    return out;
  }

  /**
   * Dialog wie in Calc. opts: { calc, cells:[…], range:"B2:B9", max: 3, onOk(rules, result) }
   */
  function dialog(box, opts) {
    const rules = [];
    let applied = [];
    box.classList.add("dlg");
    box.innerHTML = `<div class="dlg-title">${T("Bedingte Formatierung für")} <strong>${opts.range}</strong></div>
      <div class="dlg-rules"></div>
      <div class="dlg-btns"><button type="button" class="btn secondary dlg-add">${T("Hinzufügen")}</button>
      <button type="button" class="btn secondary dlg-del">${T("Löschen")}</button>
      <button type="button" class="btn dlg-ok">OK</button></div>`;
    const list = box.querySelector(".dlg-rules");
    const opHtml = OPS.map(([v, t]) => `<option value="${v}">${T(t)}</option>`).join("");
    const stHtml = STYLES.map(([v, t]) => `<option value="${v}">${T(t)}</option>`).join("");
    function addRow(pre = {}) {
      if (list.children.length >= (opts.max || 3)) return;
      const n = list.children.length + 1;
      const row = document.createElement("div");
      row.className = "dlg-rule";
      row.innerHTML = `<div class="dlg-n">${T("Bedingung")} ${n}</div>
        <div class="dlg-line"><span class="dlg-fix">${T("Zellwert ist")}</span>
          <select class="dlg-op" aria-label="${T("Bedingung")}">${opHtml}</select>
          <input class="dlg-a" size="6" aria-label="${T("Wert")}" autocomplete="off">
          <span class="dlg-und" hidden>${T("und")}</span>
          <input class="dlg-b" size="6" aria-label="${T("zweiter Wert")}" autocomplete="off" hidden></div>
        <div class="dlg-line"><span class="dlg-fix">${T("Vorlage anwenden")}</span>
          <select class="dlg-st" aria-label="${T("Vorlage")}">${stHtml}</select>
          <span class="dlg-prev" aria-hidden="true">123</span></div>`;
      list.appendChild(row);
      const op = row.querySelector(".dlg-op"), st = row.querySelector(".dlg-st"), prev = row.querySelector(".dlg-prev");
      op.value = pre.op || ">";
      st.value = pre.style || "bad";
      const sync = () => {
        const bt = op.value === "between";
        row.querySelector(".dlg-b").hidden = !bt;
        row.querySelector(".dlg-und").hidden = !bt;
        prev.className = "dlg-prev cf-" + st.value;
      };
      op.addEventListener("change", sync);
      st.addEventListener("change", sync);
      sync();
    }
    function read() {
      return [...list.children].map((row) => ({
        op: row.querySelector(".dlg-op").value,
        a: parseVal(row.querySelector(".dlg-a").value),
        b: parseVal(row.querySelector(".dlg-b").value),
        style: row.querySelector(".dlg-st").value,
        rawA: row.querySelector(".dlg-a").value,
      }));
    }
    box.querySelector(".dlg-add").addEventListener("click", () => addRow());
    box.querySelector(".dlg-del").addEventListener("click", () => { if (list.children.length > 1) list.lastChild.remove(); });
    box.querySelector(".dlg-ok").addEventListener("click", () => {
      applied = read();
      const res = apply(opts.calc, opts.cells, applied);
      if (opts.onOk) opts.onOk(applied, res);
    });
    // Ändert sich eine Zahl, passt sich die Farbe an – wie in Calc
    opts.calc.on((c, src) => {
      if (src === "reset") applied = [];
      const res = apply(c, opts.cells, applied);
      if (opts.onChange && src !== "reset") opts.onChange(applied, res, src);
    });
    addRow();
    return { rules: () => applied, reset: () => { applied = []; apply(opts.calc, opts.cells, []); list.innerHTML = ""; addRow(); } };
  }

  /** Datenbalken und Farbskala für die Expedition */
  function databar(calc, cells) {
    const vals = cells.map((a) => calc.get(a)).filter((v) => typeof v === "number");
    const max = Math.max(...vals, 0);
    cells.forEach((a) => {
      const v = calc.get(a), td = calc.tds[a];
      const p = typeof v === "number" && max > 0 ? Math.round((v / max) * 100) : 0;
      td.style.backgroundImage = `linear-gradient(90deg, rgba(99,142,198,.75) ${p}%, transparent ${p}%)`;
    });
  }
  function colorscale(calc, cells) {
    const vals = cells.map((a) => calc.get(a)).filter((v) => typeof v === "number");
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const mix = (c1, c2, t) => c1.map((x, i) => Math.round(x + (c2[i] - x) * t));
    cells.forEach((a) => {
      const v = calc.get(a), td = calc.tds[a];
      if (typeof v !== "number") return;
      const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      const rgb = t < 0.5 ? mix([248, 105, 107], [255, 235, 132], t * 2) : mix([255, 235, 132], [99, 190, 123], (t - 0.5) * 2);
      td.style.backgroundColor = `rgb(${rgb.join(",")})`;
      td.style.color = "#111";
    });
  }

  window.Regeln = { apply, dialog, styleFor, parseVal, databar, colorscale };
})();
