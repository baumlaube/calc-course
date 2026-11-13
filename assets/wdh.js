/* „Weißt du noch?“ – kurze Abruf-Aufgaben zu früheren Bausteinen (ohne Punkte, ohne Nachschauen).
   Drei Sorten: "tippen" (Formel/Zahl in die Mini-Tabelle), "zelle" (richtige Zelle anklicken), "wahl" (eine Antwort anklicken).
   mode "ueben": alle Aufgaben untereinander, mehrere Versuche, „Lösung zeigen“.
   mode "diagnose": eine Aufgabe nach der anderen, ein Versuch – am Ende steht, welche Bausteine man wiederholen soll.
   Benutzt MiniCalc (minicalc.js) und Kurs.feedback (kurs.js).
   Lizenz: CC BY-SA 4.0 · herrseibert.de · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";
  const T = (x) => (window.T ? window.T(x) : x);
  const clean = (s) => String(s).replace(/\s/g, "").toUpperCase();
  const near = (a, b) => (typeof b === "number"
    ? typeof a === "number" && Math.abs(a - b) < 0.005
    : String(a ?? "").trim().toLowerCase() === String(b).trim().toLowerCase());
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

  /** Wert einer Zelle, wenn andere Zellen probeweise anders gefüllt wären (z. B. WENN mit einem zweiten Alter testen). */
  function probe(c, changes, cell) {
    const keepRaw = {}, keepMemo = c._memo;
    Object.keys(changes).forEach((k) => { keepRaw[k] = c.raw[k]; c.raw[k] = changes[k]; });
    c._memo = new Map();
    let v;
    try { v = c.get(cell); } finally {
      Object.keys(keepRaw).forEach((k) => { c.raw[k] = keepRaw[k]; });
      c._memo = keepMemo;
    }
    return v;
  }

  /* ---------- fertige Prüfungen für typische Aufgaben ---------- */
  const NEED_EQ = "Eine Formel beginnt <strong>immer</strong> mit <code>=</code>.";
  const NO_REF = "Tippe keine Zahlen in die Formel. Nimm die Zellen, dann rechnet Calc neu.";
  const checks = {
    /** Formel mit Zellbezügen: o = { refs:["B2","C2"], value, bad:{"/100":"Hinweis"} } */
    formel: (o) => (c, raw, v) => {
      if (!raw.startsWith("=")) return NEED_EQ;
      if (/\dX\d|[A-Z]\dX/.test(raw)) return "Mal ist in Calc das Sternchen <code>*</code>, nicht x.";
      for (const k of Object.keys(o.bad || {})) if (raw.includes(k)) return o.bad[k];
      if (!o.refs.every((r) => raw.replace(/\$/g, "").includes(r))) return NO_REF;
      if (v instanceof MiniCalc.CalcError) return `Calc zeigt ${v.code}. Prüfe deine Formel.`;
      return near(v, o.value) || "Das Ergebnis stimmt noch nicht. Welches Rechenzeichen brauchst du?";
    },
    /** Funktion über einen Bereich: o = { fn:"SUMME", en:"SUM", range:"B2:B5", value, wrong:{MAX:"…"} } */
    funktion: (o) => (c, raw, v) => {
      if (!raw.startsWith("=")) return NEED_EQ;
      for (const k of Object.keys(o.wrong || {})) if (raw.includes(k + "(")) return o.wrong[k];
      if (!raw.includes(o.fn + "(") && !raw.includes(o.en + "(")) {
        return /^=[A-Z]\d+([+][A-Z]\d+)+$/.test(raw)
          ? "Das geht, aber nur bei wenigen Zellen. Nimm eine Funktion für den ganzen Bereich."
          : "Hier brauchst du eine Funktion mit einem Bereich in Klammern.";
      }
      if (raw.includes(";") && !raw.includes(":")) return "Mit <code>;</code> nimmt Calc nur die zwei Zellen. „bis“ ist der Doppelpunkt.";
      if (v instanceof MiniCalc.CalcError) return `Calc zeigt ${v.code}. Stimmt der Name? Ist die Klammer zu?`;
      return near(v, o.value) || "Das Ergebnis stimmt noch nicht. Hast du den ganzen Bereich genommen?";
    },
    /** Formel zum Ausfüllen mit einer festen Zelle: o = { fix:"B1", move:"B4", value } */
    dollar: (o) => (c, raw, v) => {
      if (!raw.startsWith("=")) return NEED_EQ;
      const plain = raw.replace(/\$/g, "");
      if (!plain.includes(o.fix) || !plain.includes(o.move)) return NO_REF;
      if (v instanceof MiniCalc.CalcError) return `Calc zeigt ${v.code}. Prüfe deine Formel.`;
      if (!near(v, o.value)) return "Das Ergebnis stimmt noch nicht. Welches Rechenzeichen brauchst du?";
      const m = o.move, f = o.fix;
      if (raw.includes(m[0] + "$" + m.slice(1))) return `${m} soll beim Ziehen mitwandern. Nur ${f} bekommt <code>$</code>.`;
      if (!raw.includes(f[0] + "$" + f.slice(1))) return `Das Ergebnis stimmt. Aber beim Ziehen rutscht ${f} nach unten. Halte ${f} mit <code>$</code> fest.`;
      return true;
    },
    /** WENN-Formel: o = { cell:"A2", cases:[[12,5],[14,8]], edge:[14, Hinweis], at:"B2", number:true, fix:"B1" } */
    wenn: (o) => (c, raw, v) => {
      if (!raw.startsWith("=")) return NEED_EQ;
      if (!raw.startsWith("=WENN(") && !raw.startsWith("=IF(")) return "Hier brauchst du <strong>WENN</strong>: <code>=WENN(Frage;Dann;Sonst)</code>";
      if (v instanceof MiniCalc.CalcError) {
        return v.code === "#NAME?"
          ? "Calc zeigt #NAME?: Text braucht Anführungszeichen, zum Beispiel <code>\"Ja\"</code>."
          : `Calc zeigt ${v.code}. Prüfe die zwei Semikolons und die Klammer.`;
      }
      if (o.number && typeof v === "string") return "In Anführungszeichen wird die Zahl zu Text. Zahlen schreibst du ohne Anführungszeichen.";
      if (o.fix) {
        const f = o.fix;
        if (!raw.replace(/\$/g, "").includes(f)) return `Tippe die Grenze nicht in die Formel. Sie steht in ${f}.`;
        if (!raw.includes(f[0] + "$" + f.slice(1))) return `Beim Ziehen rutscht ${f} nach unten. Halte ${f} mit <code>$</code> fest.`;
      }
      for (const [inp, want] of o.cases) {
        const got = probe(c, { [o.cell]: inp }, o.at);
        if (near(got, want)) continue;
        return o.edge && inp === o.edge[0] ? o.edge[1] : "Die Formel passt noch nicht für alle Fälle. Prüfe Frage, Dann und Sonst.";
      }
      return true;
    },
  };

  /* ---------- eine Aufgabe zeichnen ---------- */
  function renderItem(item, host, diag, onResult) {
    const { feedback } = window.Kurs;
    const wrap = el("div", "wdh-item");
    wrap.appendChild(el("p", "wdh-q", (item.from ? `<span class="chip">${T(item.from)}</span> ` : "") + `<span>${T(item.q)}</span>`));
    const fb = el("p", "fb");
    fb.setAttribute("aria-live", "polite");
    let finished = false;
    const more = () => (item.href ? ` <a class="wdh-link" href="${item.href}">${T("↪ Dort nachlesen")}</a>` : "");
    const finish = (ok) => { if (!finished) { finished = true; onResult(ok); } };

    if (item.type === "wahl") {
      const box = el("div", "choices");
      item.options.forEach((opt, oi) => {
        const b = el("button", "choice", T(opt));
        b.type = "button";
        b.addEventListener("click", () => {
          box.querySelectorAll("button").forEach((x, xi) => { x.disabled = true; if (xi === item.right) x.classList.add("right"); });
          const ok = oi === item.right;
          if (!ok) b.classList.add("wrong");
          const miss = !ok && item.miss && item.miss[oi] ? T(item.miss[oi]) + " " : "";
          feedback(fb, T(ok ? "✔ Richtig!" : "✘ Nicht ganz.") + " " + miss + T(item.why) + (ok ? "" : more()), ok ? "ok" : "hint");
          finish(ok);
        });
        box.appendChild(b);
      });
      wrap.append(box, fb);
      host.appendChild(wrap);
      return;
    }

    const tblBox = el("div");
    wrap.append(tblBox, fb);
    host.appendChild(wrap);
    const t = item.table;
    let armed = false, locked = false;
    const lock = (c) => {
      locked = true;
      c.editable.delete(item.cell);
      if (c.tds[item.cell]) c.tds[item.cell].classList.remove("input");
      c.el.querySelectorAll(".mc-actions .btn").forEach((b) => { b.disabled = true; });
      c.select(item.cell, false);
    };
    const giveUp = (c) => {
      if (locked) return;
      if (item.type === "tippen") c.set(item.cell, item.solution, "solution");
      lock(c);
      feedback(fb, T(item.type === "tippen" ? "So geht es:" : "Gesucht war:") + ` <code>${esc(item.type === "tippen" ? item.solution : item.cell)}</code>. ` + T(item.why || "") + more(), "info");
      finish(false);
    };
    const calc = new MiniCalc(tblBox, {
      cols: t.cols, rows: t.rows, cells: t.cells, styles: t.styles || {}, formats: t.formats || {}, decimal: "comma",
      editable: item.type === "tippen" ? [item.cell] : [], select: item.type === "tippen" ? item.cell : "A1",
      actions: [{ label: T(diag ? "Weiß ich nicht" : "Lösung zeigen"), secondary: true, onClick: giveUp }],
      onSelect: (c, a) => {
        if (item.type !== "zelle" || !armed || locked) return;
        if (a === item.cell) {
          lock(c);
          feedback(fb, T("✔ Richtig!") + " " + T(item.why || ""), "ok");
          finish(true);
        } else if (diag) {
          lock(c);
          feedback(fb, T("✘ Nicht ganz.") + " " + T(item.miss(a)) + more(), "hint");
          finish(false);
        } else feedback(fb, T(item.miss(a)), "hint");
      },
    });
    armed = true;
    if (item.type === "tippen") {
      calc.on((c, src) => {
        if (src !== "edit" || locked) return;
        const raw = clean(c.getRaw(item.cell));
        if (!raw) return;
        const r = item.check(c, raw, c.get(item.cell));
        if (r === true) {
          lock(c);
          feedback(fb, T("✔ Richtig!") + " " + T(item.why || ""), "ok");
          finish(true);
        } else if (diag) {
          lock(c);
          feedback(fb, T("✘ Nicht ganz.") + " " + T(r) + " " + T("So geht es:") + ` <code>${esc(item.solution)}</code>` + more(), "hint");
          finish(false);
        } else {
          feedback(fb, T(r), "hint");   // weiter probieren ist erlaubt
        }
      });
    }
  }

  /**
   * box: Ziel-Element · items: [{ type, from, q, href, why, … }] · opts: { mode:"ueben"|"diagnose", key, done }
   *   tippen: { table:{cols,rows,cells,styles,formats}, cell, check:(calc, ROH, wert)=>true|Hinweis, solution }
   *   zelle:  { table, cell, miss:(adresse)=>Hinweis }
   *   wahl:   { options:[…], right, miss:[…] }
   *   diagnose zusätzlich je Aufgabe: { title } (Name des Bausteins) und href (Link dorthin)
   */
  function Wdh(box, items, opts = {}) {
    const store = window.Kurs.store;
    if (opts.mode !== "diagnose") {
      let open = items.length;
      const end = el("p", "wdh-end");
      items.forEach((item) => renderItem(item, box, false, () => {
        if (--open === 0) end.innerHTML = T(opts.done || "Weiter geht es mit Schritt 1.");
      }));
      box.appendChild(end);
      return;
    }

    const n = items.length;
    const key = "calc-" + (opts.key || "diagnose");
    const result = (wrong) => {
      box.innerHTML = "";
      const good = n - wrong.length;
      box.appendChild(el("p", "wdh-res", T(`Dein Ergebnis: ${good} von ${n}`)));
      if (!wrong.length) box.appendChild(el("p", "fb show ok", T(opts.allGood || "🏆 Alles sitzt. Weiter mit Schritt 1!")));
      else {
        box.appendChild(el("p", "", T(opts.repeat || "Das solltest du zuerst wiederholen. Fang oben an:")));
        const ul = el("ul", "wdh-list");
        wrong.forEach((i) => ul.appendChild(el("li", "", `<a href="${items[i].href}">${T(items[i].title)}</a>`)));
        box.appendChild(ul);
        box.appendChild(el("p", "", T(opts.tip || "Mach dort Schritt 2 und 3. Dann komm hierher zurück.")));
      }
      if (good && wrong.length) {
        box.appendChild(el("p", "wdh-good", T("Das sitzt:") + " " + items.map((it, i) => (wrong.includes(i) ? null : T(it.title))).filter(Boolean).join(", ")));
      }
      const again = el("button", "btn secondary", T("↺ Noch einmal testen"));
      again.type = "button";
      again.addEventListener("click", () => { store.set(key, ""); step(0, []); });
      box.appendChild(again);
    };
    const step = (i, wrong) => {
      box.innerHTML = "";
      box.appendChild(el("p", "wdh-step", T(`Aufgabe ${i + 1} von ${n}`)));
      const row = el("div", "btn-row");
      const next = el("button", "btn", T(i + 1 < n ? "Weiter →" : "Ergebnis zeigen"));
      next.type = "button";
      next.hidden = true;
      next.addEventListener("click", () => {
        if (i + 1 < n) { step(i + 1, wrong); return; }
        store.set(key, JSON.stringify(wrong));
        result(wrong);
      });
      renderItem(items[i], box, true, (ok) => { if (!ok) wrong.push(i); next.hidden = false; });
      row.appendChild(next);
      box.appendChild(row);
    };
    let saved = null;
    try { saved = JSON.parse(store.get(key) || "null"); } catch (e) { saved = null; }
    if (Array.isArray(saved) && saved.every((i) => Number.isInteger(i) && i >= 0 && i < n)) result(saved);
    else step(0, []);
  }

  Wdh.checks = checks;
  Wdh.probe = probe;
  window.Wdh = Wdh;
})();
