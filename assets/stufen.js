/* Stufen-Labor – kleinschrittige WENN-Übungen im Browser, eine Stufe nach der anderen.
   Jede Stufe: eine Frage, zwei Werte in A2:A3, die Formel kommt in B2 und wird nach B3 ausgefüllt.
   Benutzt MiniCalc (minicalc.js) und Kurs.feedback (kurs.js).
   Lizenz: CC BY-SA 4.0 · herrseibert.de · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";
  const T = (x) => (window.T ? window.T(x) : x);
  const clean = (s) => String(s).replace(/\s/g, "").toUpperCase();
  const same = (a, b) => (typeof a === "string" && typeof b === "string")
    ? a.trim().toLowerCase() === b.trim().toLowerCase()
    : (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 0.005);

  /**
   * box: Element für Stufenanzeige + Tabelle · fbEl: Rückmeldung · levels: [
   *   { title, q (HTML), head, ansHead, limit:{head,value} (Grenze in C2, muss mit $C$2 benutzt werden), vals:[a2,a3], fmt ("eur"|"pct"|…), want:(v)=>Ergebnis, ansFmt, tip (HTML), wenn (false = ohne WENN),
   *     hint3: (c)=>HTML für den Fall, dass nur Zeile 3 nicht stimmt, done (HTML) } ]
   * opts.onDone: wird nach der letzten Stufe aufgerufen
   */
  function Stufen(box, fbEl, levels, opts = {}) {
    const { feedback } = window.Kurs;
    let i = 0, calc = null, filled = false, solved = false;
    const head = document.createElement("div");
    head.className = "stufen";
    const qEl = document.createElement("p");
    qEl.className = "stufen-q";
    const tblBox = document.createElement("div");
    box.append(head, tblBox, qEl);

    function chips() {
      head.innerHTML = levels.map((l, k) =>
        `<span class="stufe${k < i ? " done" : ""}${k === i ? " now" : ""}">${k < i ? "✔" : k + 1}</span>`).join("") +
        `<span class="stufen-t">${T(levels[i].title)}</span>`;
    }

    function check(c, src) {
      if (src === "reset") return;
      if (src === "fill") filled = !!c.getRaw("B3");
      const L = levels[i];
      const raw = clean(c.getRaw("B2"));
      if (!raw) { feedback(fbEl, L.tip || T("Tippe in B2 deine WENN-Formel."), "info"); return; }
      if (!raw.startsWith("=")) { feedback(fbEl, T("Eine Formel beginnt <strong>immer</strong> mit <code>=</code>. Lass WENN die Antwort finden!"), "hint"); return; }
      const v = c.get("B2");
      if (v instanceof MiniCalc.CalcError) {
        feedback(fbEl, v.code === "#NAME?"
          ? T("B2 zeigt #NAME?: Text steht immer in Anführungszeichen – auch die Antworten, z. B. <code>\"Ja\"</code>. Und die Funktion heißt WENN.")
          : T(`B2 zeigt ${v.code}. Prüfe: Text in Anführungszeichen, zwei Semikolons, Klammer zu am Ende.`), "hint");
        return;
      }
      if (L.wenn !== false && !/^=(WENN|IF)\(/.test(raw)) { feedback(fbEl, T("Fang mit <code>=WENN(</code> an."), "hint"); return; }
      if (L.textOnly === false && typeof v === "string" && /^-?\d/.test(v)) {
        feedback(fbEl, T("Da kommt Text heraus. Zahlen schreibst du <strong>ohne</strong> Anführungszeichen."), "hint"); return;
      }
      if (L.limit && /\d/.test(raw.replace(/\$?[A-Z]+\$?\d+/g, ""))) {
        feedback(fbEl, T("In deiner Formel steht eine Zahl. Nimm die Grenze aus <code>C2</code> – dann kannst du sie später ändern."), "hint"); return;
      }
      if (/\d\.\d/.test(raw)) {
        feedback(fbEl, T("Im deutschen Calc schreibst du Kommazahlen mit <strong>Komma</strong>, z. B. <code>4,95</code>."), "hint"); return;
      }
      if (/[<>=]"-?\d/.test(raw)) {
        feedback(fbEl, T("Die Zahl in der Frage steht <strong>ohne</strong> Anführungszeichen, z. B. <code>A2&gt;=50</code>. Mit Anführungszeichen ist sie für Calc Text."), "hint"); return;
      }
      if (!same(v, L.want(c.get("A2")))) { feedback(fbEl, L.hint2 ? L.hint2(c) : T("B2 passt noch nicht. Lies deine Formel als Frage."), "hint"); return; }
      if (!filled) { feedback(fbEl, T("✔ B2 stimmt! Jetzt zieh am Ausfüllkästchen von B2 nach unten bis B3."), "info"); return; }
      if (src === "edit" && clean(c.getRaw("B3")) !== clean(MiniCalc.shiftFormula(c.getRaw("B2"), 1, 0))) {
        feedback(fbEl, T("Du hast B2 geändert. Fülle noch einmal nach unten aus!"), "info"); return;
      }
      if (L.limit && !/\$C\$2/.test(raw)) { feedback(fbEl, T("Ohne <code>$</code> rutscht C2 beim Ziehen nach C3 – dort steht keine Grenze. Halte sie fest: <code>$C$2</code>."), "hint"); return; }
      if (!same(c.get("B3"), L.want(c.get("A3")))) { feedback(fbEl, L.hint3 ? L.hint3(c) : T("Zeile 3 stimmt noch nicht."), "hint"); return; }
      solved = true;
      const last = i === levels.length - 1;
      feedback(fbEl, (L.done || T("✔ Stufe geschafft!")) + (last ? "" : " " + T("Weiter mit <strong>Nächste Stufe →</strong>.")), "ok");
      if (last && opts.onDone) opts.onDone();
    }

    function load(k) {
      i = k; filled = false; solved = false;
      const L = levels[i];
      chips();
      qEl.innerHTML = L.q;
      tblBox.innerHTML = "";
      const el = document.createElement("div");
      tblBox.appendChild(el);
      const formats = { A: L.fmt || "", B: L.ansFmt || "" };
      calc = new MiniCalc(el, {
        cols: L.limit ? 3 : 2, rows: 3, decimal: "comma",
        cells: Object.assign({ A1: L.head, B1: L.ansHead || "Antwort", A2: L.vals[0], A3: L.vals[1] },
          L.limit ? { C1: L.limit.head, C2: L.limit.value } : {}),
        styles: Object.assign({ A1: "head", B1: "head" }, L.limit ? { C1: "head", C2: "fix" } : {}), formats, editable: ["B2"], fillable: ["B3"], select: "B2", drag: true,
        actions: [
          { label: T("■ B2 nach unten ausfüllen"), touch: true, onClick: async (c) => {
              if (!c.getRaw("B2")) { feedback(fbEl, T("Erst eine Formel in B2 eintippen!"), "hint"); return; }
              await c.fill("B2", ["B3"], 250);
            } },
          ...(i < levels.length - 1 ? [{ label: T("Nächste Stufe →"), onClick: () => {   // auf der letzten Stufe kein Weiter-Knopf
              if (!solved) { feedback(fbEl, T("Erst diese Stufe schaffen – dann geht es weiter."), "hint"); return; }
              load(i + 1);
            } }] : []),
          { label: T("↺ Neu"), secondary: true, onClick: (c) => { filled = false; solved = false; c.reset(); fbEl.className = "fb"; } },
        ],
      });
      calc.on(check);
      check(calc, "start");
    }

    load(0);
    return { load };
  }

  window.Stufen = Stufen;
})();
