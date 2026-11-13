/* Sprachhilfe (DaZ) für den Calc-Kurs.
   Die Seiten sind deutsch geschrieben. Wählt jemand eine andere Sprache, ersetzt dieses Skript
   die Texte aus einem Wörterbuch: Schlüssel = deutscher Text (ohne HTML), Wert = Übersetzung (mit HTML).
   Calc-Begriffe bleiben in den Übersetzungen deutsch – die Schüler arbeiten mit deutschem LibreOffice.
   Fehlt eine Übersetzung, bleibt der deutsche Text stehen.
   Lizenz: CC BY-SA 4.0 · herrseibert.de · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";
  const LANGS = {
    de: { name: "Deutsch", flag: "🇩🇪" },
    en: { name: "English", flag: "🇬🇧" },
    uk: { name: "Українська", flag: "🇺🇦" },
    ar: { name: "العربية", flag: "🇸🇾", dir: "rtl" },
    ru: { name: "Русский", flag: "🌐" },
    fr: { name: "Français", flag: "🇫🇷" },
    es: { name: "Español", flag: "🇪🇸" },
    tr: { name: "Türkçe", flag: "🇹🇷" },
    fa: { name: "فارسی / دری", flag: "🌐", dir: "rtl" },
    ro: { name: "Română", flag: "🇷🇴" },
    sq: { name: "Shqip", flag: "🇦🇱" },
    pl: { name: "Polski", flag: "🇵🇱" },
    bs: { name: "Bosanski", flag: "🇧🇦" },
  };
  const AVAILABLE = (document.currentScript && document.currentScript.dataset.langs || "de").split(",");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } },
  };
  const param = new URLSearchParams(location.search).get("lang");
  let lang = param || store.get("calc-lang") || "de";
  if (!AVAILABLE.includes(lang)) lang = "de";
  if (param && AVAILABLE.includes(param)) store.set("calc-lang", param);

  const base = (document.currentScript && document.currentScript.src || "").replace(/i18n\.js.*$/, "");
  const pageId = (document.currentScript && document.currentScript.dataset.page) || "index";

  const norm = (s) => String(s).replace(/<[a-zA-Z\/!][^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  let dict = null, patterns = [];

  /** Übersetzt einen Text oder HTML-Schnipsel. Unbekanntes bleibt deutsch. */
  function T(html) {
    if (!dict || html === null || html === undefined) return html;
    const key = norm(html);
    if (!key) return html;
    if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    for (const p of patterns) {
      const m = p.re.exec(key);
      if (!m) continue;
      const vals = m.slice(1);
      let i = 0;
      return p.value.replace(/\{(\d*)\}/g, (_, n) => (n !== "" ? vals[+n] : vals[i++]) ?? "");
    }
    return html;
  }
  window.T = T;
  window.I18N = { lang, T, ready: false };

  /* ---------- Texte im Dokument ersetzen ---------- */
  const UNIT = new Set(["H1", "H2", "H3", "P", "LI", "TH", "TD", "BUTTON", "LABEL", "SMALL", "FIGCAPTION", "A", "OPTION"]);
  const SKIP = ".mc-grid, .mc-bar, .ui-grid, .ui-bar, .ui-tabs, script, style, svg, code.raw, .lang-menu, .wort";
  const CONTROLS = "input, select, textarea, [id]";
  const isUnit = (el) => (UNIT.has(el.tagName) || el.classList.contains("t") || el.matches(".chip, .badge, .rule, .calc, .day, .types strong, .types span, .brand span, .builder > span"))
    && !el.querySelector(CONTROLS) && /\p{L}{2}/u.test(el.textContent);

  function walk(el) {
    if (el.nodeType !== 1 || el.matches(SKIP)) return;
    if (isUnit(el)) {
      const t = T(el.innerHTML);
      if (t !== el.innerHTML) { el.innerHTML = t; el.setAttribute("data-tr", ""); return; }
    }
    for (const c of Array.from(el.children)) walk(c);
  }

  /* ---------- Sprachwahl im Kopf ---------- */
  function menu() {
    const bar = document.querySelector(".top .wrap");
    if (!bar || AVAILABLE.length < 2) return;
    const wrap = document.createElement("div");
    wrap.className = "lang-menu";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-label", "Sprache / Language");
    btn.textContent = `🌐 ${LANGS[lang].name}`;
    const list = document.createElement("ul");
    list.hidden = true;
    AVAILABLE.forEach((l) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      const u = new URL(location.href);
      u.searchParams.set("lang", l);
      a.href = u.pathname + u.search + u.hash;
      a.textContent = `${LANGS[l].flag} ${LANGS[l].name}`;
      a.lang = l;
      if (l === lang) a.setAttribute("aria-current", "true");
      a.addEventListener("click", () => store.set("calc-lang", l));
      li.appendChild(a);
      list.appendChild(li);
    });
    btn.addEventListener("click", () => { list.hidden = !list.hidden; });
    document.addEventListener("click", (ev) => { if (!wrap.contains(ev.target)) list.hidden = true; });
    wrap.append(btn, list);
    bar.insertBefore(wrap, bar.querySelector(".theme-btn"));
    if (lang !== "de") {
      const note = document.createElement("div");
      note.className = "lang-note";
      note.innerHTML = T("Sprachhilfe: Die Calc-Begriffe bleiben deutsch, so wie in LibreOffice an der Schule.");
      document.querySelector("main")?.prepend(note);
    }
  }

  const domReady = new Promise((r) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", r) : r()));
  // Seitenskripte (DOMContentLoaded) erst starten, wenn das Wörterbuch da ist –
  // sonst bleiben Rückmeldungen, die gleich beim Laden erscheinen, deutsch.
  const waiting = [];
  if (lang !== "de") {
    const orig = document.addEventListener.bind(document);
    document.addEventListener = function (type, fn, opts) {
      if (type === "DOMContentLoaded" && !window.I18N.ready) { waiting.push(fn); return; }
      return orig(type, fn, opts);
    };
  }
  async function load(name) {
    try {
      const res = await fetch(`${base}i18n/${lang}/${name}.json`, { cache: "no-cache" });
      return res.ok ? await res.json() : {};
    } catch (e) { return {}; }
  }

  if (lang !== "de") {
    document.documentElement.lang = lang;
    if (LANGS[lang].dir) document.documentElement.dir = LANGS[lang].dir;
    Promise.all([load("common"), load(pageId), domReady]).then(([common, page]) => {
      dict = Object.assign({}, common, page);
      patterns = Object.keys(dict).filter((k) => k.includes("{")).map((k) => ({
        re: new RegExp("^" + k.split(/\{\d*\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)") + "$"),
        value: dict[k],
      }));
      waiting.splice(0).forEach((fn) => { try { fn(new Event("DOMContentLoaded")); } catch (e) { console.error(e); } });
      setTimeout(() => {           // nach den Seitenskripten, damit auch Quiz & Co. schon da sind
        document.title = T(document.title);
        walk(document.body);
        menu();
        window.I18N.ready = true;
        document.dispatchEvent(new Event("i18n-ready"));
      }, 0);
    });
  } else {
    domReady.then(() => setTimeout(menu, 0));
  }
})();
