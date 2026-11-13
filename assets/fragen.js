/* Formel-Fragen – mehrere Fragen zu einer Tabelle, jede Antwort ist eine Formel in einer eigenen Zelle.
   Die Fragen werden der Reihe nach geprüft; die Liste zeigt, was schon geschafft ist.
   Benutzt MiniCalc (minicalc.js) und Kurs.feedback (kurs.js).
   Lizenz: CC BY-SA 4.0 · herrseibert.de · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";
  const T = (x) => (window.T ? window.T(x) : x);
  const clean = (s) => String(s).replace(/\s/g, "").toUpperCase();
  const same = (a, b) => (typeof b === "number"
    ? typeof a === "number" && Math.abs(a - b) < 0.005
    : String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase());

  /**
   * opts: { cols, rows, cells, styles, formats, decimal, select,
   *         tasks: [{ cell, q (HTML), want:(calc)=>Wert, fn: /REGEX/ (Funktion im Rohtext), fnName, hint:(calc, v)=>HTML }],
   *         done (HTML), onDone }
   */
  function Fragen(box, fbEl, opts) {
    const { feedback } = window.Kurs;
    const el = document.createElement("div");
    const list = document.createElement("ol");
    list.className = "fragen";
    box.append(el, list);
    const tasks = opts.tasks;
    const solved = new Set();
    list.innerHTML = tasks.map((t, i) => `<li data-i="${i}"><span class="fr-st">○</span> <code>${t.cell}</code>: <span class="t">${T(t.q)}</span></li>`).join("");
    const calc = new MiniCalc(el, {
      cols: opts.cols, rows: opts.rows, cells: opts.cells, styles: opts.styles || {}, formats: opts.formats || {},
      decimal: opts.decimal || "comma", editable: tasks.map((t) => t.cell), select: opts.select || tasks[0].cell,
      actions: [{ label: T("↺ Zurücksetzen"), secondary: true, onClick: (c) => { solved.clear(); c.reset(); paint(); fbEl.className = "fb"; } }],
    });
    function paint() {
      list.querySelectorAll("li").forEach((li) => {
        const ok = solved.has(+li.dataset.i);
        li.classList.toggle("ok", ok);
        li.querySelector(".fr-st").textContent = ok ? "✔" : "○";
      });
    }
    function judge(t, c) {
      const raw = clean(c.getRaw(t.cell));
      if (!raw) return null;
      if (!raw.startsWith("=")) return T("Eine Formel beginnt <strong>immer</strong> mit <code>=</code>.");
      const v = c.get(t.cell);
      if (v instanceof MiniCalc.CalcError) {
        return v.code === "#NAME?"
          ? T(`${t.cell} zeigt #NAME?: Funktionsname richtig? Text und Vergleiche in Anführungszeichen?`)
          : T(`${t.cell} zeigt ${v.code}. Prüfe Bereiche, Semikolons und Klammern.`);
      }
      if (t.fn && !t.fn.test(raw)) return T(`Nimm die Funktion <strong>${t.fnName}</strong>.`);
      if (!same(v, t.want(c))) return t.hint ? t.hint(c, v) : T("Das Ergebnis stimmt noch nicht.");
      return true;
    }
    calc.on((c, src) => {
      if (src === "reset") return;
      // Ein gemeinsamer Rechendurchgang für alle Prüfungen – wichtig bei Zufallszahlen
      const keep = c._memo;
      c._memo = new Map();
      try { check(c); } finally { c._memo = keep; }
    });
    const check = (c) => {
      tasks.forEach((t, i) => { if (judge(t, c) === true) solved.add(i); else solved.delete(i); });
      paint();
      if (solved.size === tasks.length) {
        feedback(fbEl, T(opts.done || "🏆 Alle Fragen gelöst!"), "ok");
        if (opts.onDone) opts.onDone(c);
        return;
      }
      const cur = tasks.find((t) => t.cell === c.sel) || tasks.find((t, i) => !solved.has(i));
      const r = judge(cur, c);
      if (r === true) {
        const next = tasks.find((t, i) => !solved.has(i));
        feedback(fbEl, T(`✔ ${cur.cell} stimmt!`) + (next ? " " + T(`Weiter mit <code>${next.cell}</code>.`) : ""), "ok");
      } else if (r) feedback(fbEl, r, "hint");
      else feedback(fbEl, T(`Klick <code>${cur.cell}</code> an und tippe deine Formel.`), "info");
    };
    feedback(fbEl, T(`Klick <code>${tasks[0].cell}</code> an und tippe deine Formel.`), "info");
    return calc;
  }

  window.Fragen = Fragen;
})();
