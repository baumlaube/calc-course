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
   */
  function quiz(el, questions) {
    let answered = 0, correct = 0;
    const score = document.createElement("p");
    score.className = "quiz-score";
    score.setAttribute("aria-live", "polite");
    questions.forEach((item, qi) => {
      const q = document.createElement("p");
      q.className = "quiz-q";
      q.innerHTML = `${qi + 1}. <span class="t">${item.q}</span>`;
      el.appendChild(q);
      const box = document.createElement("div");
      box.className = "choices";
      const why = document.createElement("p");
      why.className = "fb quiz-why";
      item.options.forEach((opt, oi) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice";
        b.innerHTML = opt;
        b.addEventListener("click", () => {
          box.querySelectorAll("button").forEach((x, xi) => {
            x.disabled = true;
            if (xi === item.right) x.classList.add("right");
          });
          const ok = oi === item.right;
          if (!ok) b.classList.add("wrong");
          answered++; if (ok) correct++;
          // Falsche Antwort: erst der Denkfehler hinter genau dieser Antwort (miss), dann die Erklärung
          const miss = !ok && item.miss && item.miss[oi] ? T(item.miss[oi]) + " " : "";
          feedback(why, T(ok ? "✔ Richtig!" : "✘ Nicht ganz.") + " " + miss + T(item.why), ok ? "ok" : "hint");
          if (answered === questions.length) {
            score.innerHTML = T(correct === questions.length
              ? `🏆 ${correct} von ${questions.length} – stark!`
              : `${correct} von ${questions.length} richtig. Lies dir die Erklärungen noch einmal durch.`);
          }
        });
        box.appendChild(b);
      });
      el.appendChild(box);
      el.appendChild(why);
    });
    el.appendChild(score);
  }

  /** Ich-kann-Liste, die sich das Gerät merkt (nur lokal, nichts wird gesendet). */
  function checklist(el, key) {
    el.querySelectorAll("input[type=checkbox]").forEach((cb, i) => {
      const k = `calc-${key}-${i}`;
      cb.checked = store.get(k) === "1";
      cb.addEventListener("change", () => store.set(k, cb.checked ? "1" : "0"));
    });
  }

  /* Calc-Wörter: Wer die Sprachhilfe benutzt, sieht die Wortliste gleich aufgeklappt. */
  document.addEventListener("DOMContentLoaded", () => {
    if (document.documentElement.lang && document.documentElement.lang !== "de") {
      document.querySelectorAll("details.woerter").forEach((d) => { d.open = true; });
    }
  });

  window.Kurs = { feedback, quiz, checklist, store };
})();
