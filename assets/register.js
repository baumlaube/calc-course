/* Calc-Kurs · Register: Die Lernschritte einer Seite als Reiter.
   Immer nur ein Schritt ist offen. Spätere Reiter sind grau, bis man mit „Weiter“ hinkommt.
   „Weiter“ erscheint sofort – außer bei Schritten mit data-wait: dort erst, wenn die Seite
   Register.done("id") meldet (Vorhersage gewählt, alle Stufen geschafft, Kurz-Check richtig …).
   Erreichte Reiter kann man jederzeit wieder anklicken. Der Stand bleibt im Browser gespeichert.
   Lizenz: CC BY-SA 4.0 · herrseibert.de · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";
  const T = (x) => (window.T ? window.T(x) : x);

  /**
   * box: Element mit den Schritt-Abschnitten (section.card) als Kindern
   * opts: { key: Speicher-Schlüssel, after: id des Abschnitts nach dem letzten Schritt, nr: Lektionsnummer, z. B. "9.3" }
   */
  function Register(box, opts = {}) {
    const store = window.Kurs.store;
    const key = "register:" + (opts.key || location.pathname);
    const panels = Array.from(box.children).filter((e) => e.matches("section"));
    const wait = new Set(panels.filter((p) => p.hasAttribute("data-wait")).map((p) => p.id));
    let saved = {};
    try { saved = JSON.parse(store.get(key) || "{}"); } catch (e) { saved = {}; }
    const done = new Set((saved.done || []).filter((id) => wait.has(id)));
    panels.forEach((p) => { if (!wait.has(p.id)) done.add(p.id); });
    let reached = Math.min(Math.max(saved.reached || 0, 0), panels.length - 1);   // weitester Reiter
    let cur = reached;

    const save = () => store.set(key, JSON.stringify({ reached, done: [...done].filter((id) => wait.has(id)) }));

    const bar = document.createElement("div");
    bar.className = "reg-tabs";
    bar.setAttribute("role", "tablist");

    const tabs = panels.map((p, i) => {
      const h = p.querySelector("h2");
      const no = (h && h.querySelector(".step-no") || {}).textContent || String(i + 1);
      const label = h ? h.cloneNode(true) : document.createElement("span");
      label.querySelectorAll(".step-no, .chip").forEach((x) => x.remove());
      const b = document.createElement("button");
      b.type = "button";
      b.className = "reg-tab";
      b.id = "reg-tab-" + p.id;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", p.id);
      const text = p.dataset.tab ? T(p.dataset.tab) : label.innerHTML.trim();   // data-tab: kurzer Reitername
      b.innerHTML = `<span class="reg-no">${no}</span><span class="reg-label">${text}</span>`;
      b.title = b.querySelector(".reg-label").textContent.trim();   // voller Name, falls er gekürzt ist
      b.addEventListener("click", () => { if (i <= reached) show(i, false); });

      p.classList.add("reg-panel");
      p.setAttribute("role", "tabpanel");
      p.setAttribute("aria-labelledby", b.id);
      const last = i === panels.length - 1;
      const nav = document.createElement("div");
      nav.className = "reg-next";
      const nb = document.createElement("button");
      nb.type = "button";
      nb.className = "btn";
      nb.textContent = last ? T("Weiter zu den Übungen in Calc ↓") : T("Weiter →");
      nb.addEventListener("click", () => {
        if (last) {
          const after = opts.after && document.getElementById(opts.after);
          if (after) after.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        reached = Math.max(reached, i + 1);
        save();
        show(i + 1, true);
      });
      nav.appendChild(nb);
      p.appendChild(nav);
      return { b, nav, p };
    });
    bar.append(...tabs.map((t) => t.b));
    if (opts.nr) {   // Lektionsnummer rechts im Balken: Die Lehrkraft sieht im Vorbeigehen, ob die richtige Lektion offen ist
      const nr = document.createElement("span");
      nr.className = "reg-nr";
      nr.textContent = opts.nr;
      nr.setAttribute("aria-hidden", "true");
      bar.appendChild(nr);
    }
    box.prepend(bar);
    box.classList.add("register");

    function refresh() {
      tabs.forEach((t, i) => {
        const locked = i > reached;
        t.b.disabled = locked;
        t.b.classList.toggle("locked", locked);
        t.b.classList.toggle("passed", i < reached);
        t.b.classList.toggle("active", i === cur);
        t.b.setAttribute("aria-selected", i === cur ? "true" : "false");
        t.b.tabIndex = i === cur ? 0 : -1;
        t.p.hidden = i !== cur;
        t.nav.hidden = !done.has(t.p.id);
      });
    }

    function show(i, scroll) {
      cur = i;
      refresh();
      tabs[i].b.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (scroll && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // Pfeiltasten im Reiterbalken
    bar.addEventListener("keydown", (ev) => {
      const d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const n = cur + (document.dir === "rtl" ? -d : d);
      if (n >= 0 && n <= reached) { show(n, false); tabs[n].b.focus(); ev.preventDefault(); }
    });

    document.addEventListener("register-done", (ev) => {
      const id = ev.detail;
      if (!wait.has(id) || done.has(id)) return;
      done.add(id);
      save();
      refresh();
    });

    show(cur, false);
  }

  /** Meldet: Schritt mit dieser id ist bearbeitet – „Weiter“ erscheint. */
  Register.done = (id) => document.dispatchEvent(new CustomEvent("register-done", { detail: id }));

  window.Register = Register;
})();
