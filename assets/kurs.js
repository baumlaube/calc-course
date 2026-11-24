/* Calc-Kurs · gemeinsame Bausteine: Hell/Dunkel, Quiz, Ich-kann-Liste. Lizenz: CC BY-SA 4.0 · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privat-Modus: egal */ } },
  };

  const T = (x) => (window.T ? window.T(x) : x);   // Sprachhilfe (i18n.js), falls geladen

  /* Hell / Dunkel */
  const saved = store.get("calc-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest(".theme-btn");
    if (!b) return;
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("calc-theme", next);
  });

  /** Rückmeldung in einem .fb-Element anzeigen. kind: ok | hint | info */
  function feedback(el, html, kind) {
    el.className = "fb show " + kind;
    el.innerHTML = T(html);
  }

  /**
   * Quiz: questions = [{ q, options:[...], right: index, why, miss:[...] }]
   * miss (optional): pro Antwort ein Satz zum typischen Denkfehler dahinter (null bei der richtigen).
   * Ablauf: Antworten wählen (änderbar) → „Prüfen“. Richtige werden fest, falsche bleiben offen
   * und können verbessert werden → „Nochmal prüfen“. Gezählt wird das erste Prüfen.
   */
  function quiz(el, questions, opts = {}) {
    const pick = questions.map(() => null);
    const done = questions.map(() => false);
    let first = null;                       // Punkte beim ersten Prüfen
    const parts = [];
    questions.forEach((item, qi) => {
      const q = document.createElement("p");
      q.className = "quiz-q";
      q.innerHTML = `${qi + 1}. <span class="t">${item.q}</span>`;
      el.appendChild(q);
      const box = document.createElement("div");
      box.className = "choices";
      const why = document.createElement("p");
      why.className = "fb quiz-why";
      why.setAttribute("aria-live", "polite");
      const btns = item.options.map((opt, oi) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice";
        b.innerHTML = opt;
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => {
          if (done[qi]) return;
          pick[qi] = oi;
          btns.forEach((x, xi) => {
            x.classList.toggle("picked", xi === oi);
            x.classList.remove("wrong");
            x.setAttribute("aria-pressed", String(xi === oi));
          });
          why.className = "fb quiz-why";      // alte Rückmeldung weg, sobald neu gewählt wird
        });
        box.appendChild(b);
        return b;
      });
      el.appendChild(box);
      el.appendChild(why);
      parts.push({ btns, why });
    });

    const row = document.createElement("div");
    row.className = "btn-row";
    const check = document.createElement("button");
    check.type = "button";
    check.className = "btn";
    check.textContent = T("Prüfen");
    row.appendChild(check);
    el.appendChild(row);
    const score = document.createElement("p");
    score.className = "quiz-score";
    score.setAttribute("aria-live", "polite");
    el.appendChild(score);

    check.addEventListener("click", () => {
      const open = pick.map((p, i) => (p === null && !done[i] ? i + 1 : 0)).filter(Boolean);
      if (open.length) {
        score.innerHTML = T(open.length === 1
          ? `Frage ${open[0]} fehlt noch.`
          : `Diese Fragen fehlen noch: ${open.join(", ")}`);
        return;
      }
      let correct = 0;
      questions.forEach((item, qi) => {
        const { btns, why } = parts[qi];
        if (done[qi]) { correct++; return; }
        const oi = pick[qi], ok = oi === item.right;
        if (ok) {
          done[qi] = true; correct++;
          btns.forEach((x, xi) => { x.disabled = true; x.classList.remove("picked"); if (xi === item.right) x.classList.add("right"); });
          window.Kurs.feedback(why, T("✔ Richtig!") + " " + T(item.why), "ok"); why.classList.add("quiz-why");
        } else {
          btns[oi].classList.add("wrong");
          const miss = item.miss && item.miss[oi] ? T(item.miss[oi]) : T("Überleg noch einmal und wähle eine andere Antwort.");
          window.Kurs.feedback(why, T("✘ Nicht ganz.") + " " + miss, "hint"); why.classList.add("quiz-why");
        }
      });
      const n = questions.length;
      if (first === null) first = correct;
      if (correct === n) {
        check.hidden = true;
        if (opts.onDone) opts.onDone();
        score.innerHTML = T(first === n ? `🏆 ${n} von ${n} – stark!` : `✔ Jetzt stimmt alles. Beim ersten Prüfen: ${first} von ${n}.`);
      } else {
        check.textContent = T("Nochmal prüfen");
        score.innerHTML = T(`${correct} von ${n} richtig. Ändere die markierten Antworten und prüfe noch einmal.`);
      }
    });
  }

  /* Die Startseite öffnet beim nächsten Mal gleich den Reiter der zuletzt besuchten Seite. */
  const reiter = location.pathname.match(/\/(k\d|extra)\/[^/]+\.html$/);
  if (reiter) store.set("calc-klasse", reiter[1] === "extra" ? "mehr" : reiter[1]);

  /* Calc-Wörter: Wer die Sprachhilfe benutzt, sieht die Wortliste gleich aufgeklappt. */
  document.addEventListener("DOMContentLoaded", () => {
    if (document.documentElement.lang && document.documentElement.lang !== "de") {
      document.querySelectorAll("details.woerter").forEach((d) => { d.open = true; });
    }
  });

  /* Tabellen-Bild: eine feste Tabelle zum Anschauen (keine Eingabezeile, nichts anklickbar).
     Formeln stehen sichtbar in der Zelle – wie ein Ausschnitt aus Calc.
     opts: { cols, rows, cells: {A1: "…"}, styles: {A1: "head"}, mark: "B2" } */
  function bild(el, { cols, rows, cells = {}, styles = {}, mark }) {
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let h = '<table class="bild"><thead><tr><th></th>';
    for (let c = 0; c < cols; c++) h += `<th>${String.fromCharCode(65 + c)}</th>`;
    h += "</tr></thead><tbody>";
    for (let r = 1; r <= rows; r++) {
      h += `<tr><th>${r}</th>`;
      for (let c = 0; c < cols; c++) {
        const a = String.fromCharCode(65 + c) + r, v = cells[a];
        const f = typeof v === "string" && v.startsWith("=");
        const cls = [styles[a] || "", f ? "f" : "", typeof v === "number" ? "num" : "", a === mark ? "mark" : ""].filter(Boolean).join(" ");
        h += `<td${cls ? ` class="${cls}"` : ""}>${v === undefined ? "" : f ? `<code>${esc(v)}</code>` : esc(T(String(v)))}</td>`;
      }
      h += "</tr>";
    }
    el.innerHTML = h + "</tbody></table>";
  }

  window.Kurs = { feedback, quiz, store, bild };
})();
