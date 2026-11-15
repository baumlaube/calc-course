/* MiniCalc – eine winzige Tabellenkalkulation zum Üben im Browser.
   Kann: Zahlen, Prozente (20 %), Datum, Text mit &, WENN/UND/ODER, ZÄHLENWENN, SUMMEWENN, SVERWEIS, RUNDEN, Text- und Datumsfunktionen, Formeln mit + - * / ^ ( ), Zellbezüge mit $, SUMME/MIN/MAX/MITTELWERT,
   Ausfüllen (relative/absolute/gemischte Bezüge) und farbige Bezugsrahmen wie in LibreOffice Calc.
   Lizenz: CC BY-SA 4.0 · herrseibert.de · Erstellt von der KI Claude von Anthropic. */
(function () {
  "use strict";

  const REF_COLORS = ["#1f6feb", "#d1242f", "#8250df", "#1a7f37", "#bf8700", "#0a7ea4"];
  const colNum = (s) => s.charCodeAt(0) - 64;
  const colName = (n) => String.fromCharCode(64 + n);
  const parseAddr = (a) => { const m = /^([A-Z])(\d+)$/.exec(a); return m ? { c: colNum(m[1]), r: +m[2] } : null; };
  const addr = (c, r) => colName(c) + r;

  class CalcError { constructor(code) { this.code = code; } toString() { return this.code; } }
  const E = {
    VAL: new CalcError("#WERT!"), REF: new CalcError("#BEZUG!"), DIV: new CalcError("#DIV/0!"),
    NAME: new CalcError("#NAME?"), NA: new CalcError("#NV"), SYN: new CalcError("Err:509"), CIRC: new CalcError("Err:522"),
  };

  // Funktionen, deren Bereichs-Argumente als Tabelle (nicht flach) übergeben werden
  const RANGE_FNS = new Set(["ZÄHLENWENN", "COUNTIF", "SUMMEWENN", "SUMIF", "SVERWEIS", "VLOOKUP"]);
  const KNOWN_FNS = new Set(["SUMME", "SUM", "MIN", "MAX", "MITTELWERT", "AVERAGE", "ANZAHL", "COUNT", "ZUFALLSBEREICH",
    "RANDBETWEEN", "UND", "AND", "ODER", "OR", ...RANGE_FNS, "RUNDEN", "ROUND", "GANZZAHL", "INT", "ABS", "ZUFALLSZAHL",
    "RAND", "HEUTE", "TODAY", "DATUM", "DATE", "JAHR", "YEAR", "MONAT", "MONTH", "TAG", "DAY", "WOCHENTAG", "WEEKDAY",
    "LINKS", "LEFT", "RECHTS", "RIGHT", "LÄNGE", "LEN", "KLEIN", "LOWER", "GROSS", "UPPER", "VERKETTEN", "CONCATENATE",
    "WECHSELN", "SUBSTITUTE", "GLÄTTEN", "TRIM"]);
  const fmtNumDe = (x) => String(Math.round(x * 1e9) / 1e9).replace(".", ",");
  // Datum wie in Calc: Tage seit dem 30.12.1899
  const EPOCH = Date.UTC(1899, 11, 30);
  const serial = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
  const fromSerial = (n) => new Date(EPOCH + Math.floor(n) * 86400000);
  // Suchkriterium wie bei ZÄHLENWENN: 5, "ja", ">=50", "<>ja"
  function crit(v, c, exactOnly) {
    if (c instanceof CalcError) throw c;
    if (typeof c === "number") return typeof v === "number" && v === c;
    if (typeof c === "boolean") return v === c;
    const s = String(c ?? "");
    const m = exactOnly ? null : /^(<=|>=|<>|<|>|=)(.*)$/.exec(s);
    const op = m ? m[1] : "=", rest = m ? m[2] : s;
    const isNum = /^-?\d+(?:[.,]\d+)?$/.test(rest.trim());
    const target = isNum ? parseFloat(rest.replace(",", ".")) : rest.toLowerCase();
    if (v === null || v === "") return op === "<>" ? rest !== "" : rest === "" && op === "=";
    if (isNum && typeof v !== "number") return op === "<>";
    if (!isNum && typeof v === "number") return op === "<>";
    const x = typeof v === "string" ? v.toLowerCase() : v;
    switch (op) {
      case "=": return x === target;
      case "<>": return x !== target;
      case "<": return x < target;
      case ">": return x > target;
      case "<=": return x <= target;
      case ">=": return x >= target;
    }
    return false;
  }

  /* ---------------- Formeln lesen ---------------- */
  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const rest = src.slice(i);
      let m;
      if (/^\s/.test(rest)) { i++; continue; }
      if ((m = /^[A-Za-zÄÖÜäöü]+(?=\s*\()/.exec(rest))) { out.push({ t: "fn", v: m[0].toUpperCase() }); i += m[0].length; continue; }
      if ((m = /^"([^"]*)"/.exec(rest))) { out.push({ t: "str", v: m[1] }); i += m[0].length; continue; }
      // Bezug nur, wenn kein Buchstabe direkt folgt – sonst ist es (wie in Calc) ein unbekannter Name: =B7C7 → #NAME?
      if ((m = /^\$?[A-Za-z]\$?\d+(:\$?[A-Za-z]\$?\d+)?(?![A-Za-z\d])/.exec(rest))) {
        out.push({ t: m[1] ? "range" : "ref", v: m[0].toUpperCase().replace(/\$/g, "") }); i += m[0].length; continue;
      }
      if ((m = /^\d+(?:[.,]\d+)?/.exec(rest))) { out.push({ t: "num", v: parseFloat(m[0].replace(",", ".")) }); i += m[0].length; continue; }
      if ((m = /^(<=|>=|<>|<|>|=)/.exec(rest))) { out.push({ t: "op", v: m[0] }); i += m[0].length; continue; }
      if ("+-*/^();%&".includes(rest[0])) { out.push({ t: "op", v: rest[0] }); i++; continue; }
      if ((m = /^[A-Za-zÄÖÜäöü_][A-Za-zÄÖÜäöü_\d]*/.exec(rest))) { out.push({ t: "name", v: m[0] }); i += m[0].length; continue; }
      throw E.SYN;
    }
    return out;
  }

  function evaluate(src, getVal) {
    return evalTokens(tokenize(src), getVal);
  }

  function evalTokens(tk, getVal) {
    // Wie Calc: Ein unbekanntes Wort (z. B. Text ohne Anführungszeichen) ergibt immer #NAME? – auch im nicht benutzten WENN-Teil
    if (tk.some((x) => x.t === "name")) throw E.NAME;
    let p = 0;
    const peek = () => tk[p];
    const isOp = (v) => tk[p] && tk[p].t === "op" && tk[p].v === v;
    const num = (v) => {
      if (v instanceof CalcError) throw v;
      if (v === null || v === "") return 0;
      if (typeof v === "number") return v;
      if (typeof v === "boolean") return v ? 1 : 0;
      throw E.VAL;
    };
    const CMP = ["=", "<>", "<", ">", "<=", ">="];
    function concat() {
      let v = expr();
      while (isOp("&")) {
        p++; const r = expr();
        const s = (x) => { if (x instanceof CalcError) throw x; return x === null ? "" : typeof x === "number" ? fmtNumDe(x) : typeof x === "boolean" ? (x ? "WAHR" : "FALSCH") : String(x); };
        v = s(v) + s(r);
      }
      return v;
    }
    function compare() {
      let v = concat();
      while (tk[p] && tk[p].t === "op" && CMP.includes(tk[p].v)) {
        const o = tk[p++].v; const r = concat();
        v = cmp(v, r, o);
      }
      return v;
    }
    function cmp(a, b, o) {
      if (a instanceof CalcError) throw a;
      if (b instanceof CalcError) throw b;
      // wie Calc: leere Zelle passt zu 0 und zu ""; Text ohne Groß/klein; Zahlen sind „kleiner“ als Text
      const norm = (x, other) => (x === null ? (typeof other === "string" ? "" : 0) : typeof x === "boolean" ? (x ? 1 : 0) : x);
      let x = norm(a, b), y = norm(b, a);
      let d;
      if (typeof x === "string" && typeof y === "string") d = x.toLowerCase().localeCompare(y.toLowerCase(), "de");
      else if (typeof x === "number" && typeof y === "number") d = x - y;
      else d = typeof x === "number" ? -1 : 1;
      return { "=": d === 0, "<>": d !== 0, "<": d < 0, ">": d > 0, "<=": d <= 0, ">=": d >= 0 }[o];
    }
    function splitArgs() {
      // Argumente als Token-Listen, ohne sie auszuwerten (für WENN und WENNFEHLER)
      p++; if (!isOp("(")) throw E.SYN;
      let depth = 0, start = p + 1;
      const parts = [];
      for (; p < tk.length; p++) {
        const x = tk[p];
        if (x.t === "op" && x.v === "(") depth++;
        else if (x.t === "op" && x.v === ")") { depth--; if (depth === 0) { parts.push(tk.slice(start, p)); break; } }
        else if (x.t === "op" && x.v === ";" && depth === 1) { parts.push(tk.slice(start, p)); start = p + 1; }
      }
      if (depth !== 0) throw E.SYN;
      p++;
      return parts;
    }
    function expr() {
      let v = term();
      while (isOp("+") || isOp("-")) {
        const o = tk[p++].v; const r = term();
        v = o === "+" ? num(v) + num(r) : num(v) - num(r);
      }
      return v;
    }
    function term() {
      let v = power();
      while (isOp("*") || isOp("/")) {
        const o = tk[p++].v; const r = power();
        if (o === "*") v = num(v) * num(r);
        else { const d = num(r); if (d === 0) throw E.DIV; v = num(v) / d; }
      }
      return v;
    }
    function power() {
      let v = unary();
      while (isOp("^")) { p++; v = Math.pow(num(v), num(unary())); }
      return v;
    }
    function unary() {
      if (isOp("-")) { p++; return -num(unary()); }
      if (isOp("+")) { p++; return num(unary()); }
      let v = primary();
      while (isOp("%")) { p++; v = num(v) / 100; }   // wie Calc: =B4*20% rechnet mit 0,2
      return v;
    }
    function rangeVals(r) {
      const [a, b] = r.split(":").map(parseAddr);
      if (!a || !b) throw E.REF;
      const vals = [];
      for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++)
        for (let rr = Math.min(a.r, b.r); rr <= Math.max(a.r, b.r); rr++) vals.push(getVal(addr(c, rr)));
      return vals;
    }
    function rangeGrid(r) {
      const [a, b] = r.split(":").map(parseAddr);
      if (!a || !b) throw E.REF;
      const rows = [];
      for (let rr = Math.min(a.r, b.r); rr <= Math.max(a.r, b.r); rr++) {
        const row = [];
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) row.push(getVal(addr(c, rr)));
        rows.push(row);
      }
      return rows;
    }
    function primary() {
      const t = peek();
      if (!t) throw E.SYN;
      if (t.t === "num") { p++; return t.v; }
      if (t.t === "str") { p++; return t.v; }
      if (t.t === "ref") { p++; const v = getVal(t.v); if (v instanceof CalcError) throw v; return v; }
      if (t.t === "op" && t.v === "(") { p++; const v = compare(); if (!isOp(")")) throw E.SYN; p++; return v; }
      if (t.t === "fn" && (t.v === "WENNFEHLER" || t.v === "IFERROR")) {
        // Argumente einzeln auswerten, damit ein Fehler im ersten Teil abgefangen werden kann
        const parts = splitArgs();
        if (parts.length !== 2) throw E.SYN;
        try {
          const v = evalTokens(parts[0], getVal);
          if (v instanceof CalcError) throw v;
          return v;
        } catch (e) {
          if (!(e instanceof CalcError)) throw e;
          return evalTokens(parts[1], getVal);
        }
      }
      if (t.t === "fn" && (t.v === "WENN" || t.v === "IF")) {
        // Nur der passende Teil wird ausgerechnet – wie in Calc
        const parts = splitArgs();
        if (parts.length < 2 || parts.length > 3 || !parts[0].length) throw E.SYN;
        const c = evalTokens(parts[0], getVal);
        if (c instanceof CalcError) throw c;
        if (typeof c === "string") throw E.VAL;
        const yes = c === true || (typeof c === "number" && c !== 0);
        if (yes) return parts[1].length ? evalTokens(parts[1], getVal) : 0;
        if (parts.length < 3) return false;
        return parts[2].length ? evalTokens(parts[2], getVal) : 0;
      }
      if (t.t === "fn") {
        p++; if (!isOp("(")) throw E.SYN; p++;
        const args = [];
        if (!isOp(")")) {
          do {
            if (args.length) p++;
            if (peek() && peek().t === "range" && RANGE_FNS.has(t.v)) { args.push({ grid: rangeGrid(tk[p++].v) }); }
            else if (peek() && peek().t === "range") { args.push(...rangeVals(tk[p++].v)); }
            else if (isOp(")") || isOp(";")) args.push(null);   // leeres Argument
            else args.push(compare());
          } while (isOp(";"));
        }
        if (!isOp(")")) throw E.SYN; p++;
        // Wie Calc: Ein unbekannter Funktionsname meldet #NAME?, auch wenn die Argumente selbst Fehler enthalten
        if (!KNOWN_FNS.has(t.v)) throw E.NAME;
        for (const a of args) if (a instanceof CalcError) throw a;
        const flat = (g) => g.grid.flat();
        const str = (x) => (x === null ? "" : typeof x === "number" ? fmtNumDe(x) : String(x));
        const n1 = (x) => num(x);
        const nums = args.filter((a) => typeof a === "number");
        switch (t.v) {
          case "SUMME": case "SUM": return nums.reduce((s, x) => s + x, 0);
          case "MIN": return nums.length ? Math.min(...nums) : 0;
          case "MAX": return nums.length ? Math.max(...nums) : 0;
          case "MITTELWERT": case "AVERAGE": if (!nums.length) throw E.DIV; return nums.reduce((s, x) => s + x, 0) / nums.length;
          case "ANZAHL": case "COUNT": return nums.length;
          case "UND": case "AND": case "ODER": case "OR": {
            const bs = args.filter((a) => a !== null && a !== "").map((a) => {
              if (typeof a === "string") throw E.VAL;
              return a === true || (typeof a === "number" && a !== 0);
            });
            if (!bs.length) throw E.VAL;
            return (t.v === "UND" || t.v === "AND") ? bs.every(Boolean) : bs.some(Boolean);
          }
          case "ZUFALLSBEREICH": case "RANDBETWEEN": {
            if (nums.length !== 2) throw E.VAL;
            const lo = Math.ceil(Math.min(...nums)), hi = Math.floor(Math.max(...nums));
            return lo + Math.floor(Math.random() * (hi - lo + 1));
          }
          case "ZÄHLENWENN": case "COUNTIF": {
            if (!args[0] || !args[0].grid || args.length !== 2) throw E.VAL;
            return flat(args[0]).filter((v) => crit(v, args[1])).length;
          }
          case "SUMMEWENN": case "SUMIF": {
            if (!args[0] || !args[0].grid || args.length < 2) throw E.VAL;
            const keys = flat(args[0]), vals = args[2] && args[2].grid ? flat(args[2]) : keys;
            return keys.reduce((s, k, i) => s + (crit(k, args[1]) && typeof vals[i] === "number" ? vals[i] : 0), 0);
          }
          case "SVERWEIS": case "VLOOKUP": {
            if (args.length < 3 || !args[1] || !args[1].grid) throw E.VAL;
            const key = args[0], rows = args[1].grid, col = n1(args[2]);
            const exact = args.length > 3 && (args[3] === 0 || args[3] === false);
            if (col < 1 || col > rows[0].length) throw E.REF;
            let hit = -1;
            if (exact) hit = rows.findIndex((r) => crit(r[0], key, true));
            else rows.forEach((r, i) => { if (typeof r[0] === typeof key && r[0] !== null && r[0] <= key) hit = i; });
            if (hit < 0) throw E.NA;
            return rows[hit][col - 1];
          }
          case "RUNDEN": case "ROUND": { const f = Math.pow(10, args.length > 1 ? n1(args[1]) : 0); return Math.round(n1(args[0]) * f + 1e-9 * Math.sign(n1(args[0]))) / f; }
          case "GANZZAHL": case "INT": return Math.floor(n1(args[0]));
          case "ABS": return Math.abs(n1(args[0]));
          case "ZUFALLSZAHL": case "RAND": return Math.random();
          case "HEUTE": case "TODAY": { const d = new Date(); return serial(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
          case "DATUM": case "DATE": return serial(n1(args[0]), n1(args[1]), n1(args[2]));
          case "JAHR": case "YEAR": return fromSerial(n1(args[0])).getUTCFullYear();
          case "MONAT": case "MONTH": return fromSerial(n1(args[0])).getUTCMonth() + 1;
          case "TAG": case "DAY": return fromSerial(n1(args[0])).getUTCDate();
          case "WOCHENTAG": case "WEEKDAY": return fromSerial(n1(args[0])).getUTCDay() + 1;
          case "LINKS": case "LEFT": return str(args[0]).slice(0, args.length > 1 ? n1(args[1]) : 1);
          case "RECHTS": case "RIGHT": { const x = str(args[0]); const k = args.length > 1 ? n1(args[1]) : 1; return k ? x.slice(-k) : ""; }
          case "LÄNGE": case "LEN": return str(args[0]).length;
          case "KLEIN": case "LOWER": return str(args[0]).toLowerCase();
          case "GROSS": case "UPPER": return str(args[0]).toUpperCase();
          case "VERKETTEN": case "CONCATENATE": return args.map(str).join("");
          case "WECHSELN": case "SUBSTITUTE": return str(args[0]).split(str(args[1])).join(str(args[2]));
          case "GLÄTTEN": case "TRIM": return str(args[0]).trim().replace(/\s+/g, " ");
          default: throw E.NAME;
        }
      }
      if (t.t === "name") throw E.NAME;
      if (t.t === "range") throw E.VAL;
      throw E.SYN;
    }
    const v = compare();
    if (p < tk.length) throw E.SYN;
    return v;
  }

  /** Verschiebt eine Formel beim Ausfüllen um dr Zeilen und dc Spalten. */
  function shiftFormula(f, dr, dc) {
    return f.replace(/(?<![A-Za-zÄÖÜäöü])(\$?)([A-Za-z])(\$?)(\d+)(?![\d(])/g, (m, dC, col, dR, row) => {
      const c = dC ? colNum(col.toUpperCase()) : colNum(col.toUpperCase()) + dc;
      const r = dR ? +row : +row + dr;
      if (c < 1 || r < 1 || c > 26) return "#BEZUG!";
      return dC + colName(c) + dR + r;
    });
  }

  /* Reihen wie beim Ziehen in Calc: 1 → 2, 3 · 10, 20 → 30 · Montag → Dienstag · Quartal 3 → Quartal 4 · 24.12. → 25.12. */
  const LISTS = [
    ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
    ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
    ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
  ];
  const SER_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/;
  /** Wert für den i-ten Schritt (1, 2, …) nach den Startwerten src (Rohwerte, in Ziehrichtung). null = einfach kopieren. */
  function seriesStep(src, i) {
    const k = src.length, last = src[k - 1];
    if (src.some((v) => typeof v === "string" && v.startsWith("="))) return null;
    if (src.every((v) => typeof v === "number")) {
      if (k === 1) return last + i;
      const d = src[1] - src[0];
      if (!src.every((v, j) => j === 0 || Math.abs(v - src[j - 1] - d) < 1e-9)) return null;
      return Math.round((last + i * d) * 1e9) / 1e9;
    }
    if (k !== 1 || typeof last !== "string") return null;
    const s = last.trim();
    let m = SER_DATE.exec(s);
    if (m) {
      const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      const d = new Date(Date.UTC(y, +m[2] - 1, +m[1] + i));
      return [d.getUTCDate(), d.getUTCMonth() + 1].map((x) => String(x).padStart(2, "0")).join(".") + "." + d.getUTCFullYear();
    }
    for (const list of LISTS) {
      const j = list.findIndex((w) => w.toLowerCase() === s.toLowerCase());
      if (j < 0) continue;
      const w = list[(((j + i) % list.length) + list.length) % list.length];
      if (s === s.toUpperCase()) return w.toUpperCase();
      if (s === s.toLowerCase()) return w.toLowerCase();
      return w;
    }
    m = /^(.*\D)(\d+)$/.exec(s);   // Text mit Zahl am Ende: „Quartal 3“ → „Quartal 4“
    if (m) return m[1] + Math.max(0, +m[2] + i);
    return null;
  }

  /** Liefert die Bezüge einer Formel in Reihenfolge (ohne $), für die farbigen Rahmen. */
  function formulaRefs(f) {
    const refs = [];
    const re = /(?<![A-Za-zÄÖÜäöü])\$?([A-Za-z])\$?(\d+)(?::\$?([A-Za-z])\$?(\d+))?(?![\d(])/g;
    let m;
    while ((m = re.exec(f))) {
      const text = m[0].toUpperCase();
      const a = { c: colNum(m[1].toUpperCase()), r: +m[2] };
      const b = m[3] ? { c: colNum(m[3].toUpperCase()), r: +m[4] } : a;
      const cells = [];
      for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++)
        for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) cells.push(addr(c, r));
      if (!refs.some((x) => x.text === text)) refs.push({ text, cells });
    }
    return refs;
  }

  const T = (x) => (window.T ? window.T(x) : x);   // Sprachhilfe (i18n.js), falls geladen
  const fmtEUR = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  // „20%“ oder „20 %“ tippen ergibt wie in Calc die Zahl 0,2 im Prozentformat
  const PCT_RE = /^-?\d+(?:,\d+)?\s*%$/;
  const DATE_RE = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/;   // 24.12.2026 wird wie in Calc ein Datum
  const fmtNum = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6 });

  /* Touch-Geräte erkennen: Touchscreen vorhanden oder die erste Berührung kam vom Finger.
     Dann bekommt <html> die Klasse mc-touch und Knöpfe mit touch: true werden sichtbar. */
  let touch = false;
  const setTouch = (on) => { if (on && !touch) { touch = true; document.documentElement.classList.add("mc-touch"); } };
  if (window.matchMedia) {
    const mq = window.matchMedia("(any-pointer: coarse)");
    setTouch(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", (e) => setTouch(e.matches));
  }
  document.addEventListener("pointerdown", (ev) => { if (ev.pointerType === "touch") setTouch(true); }, true);
  const expand = (list) => (list || []).flatMap((x) => {
    const m = /^([A-Z]\d+):([A-Z]\d+)$/.exec(x);
    if (!m) return [x];
    const A = parseAddr(m[1]), B = parseAddr(m[2]), out = [];
    for (let r = A.r; r <= B.r; r++) for (let c = A.c; c <= B.c; c++) out.push(addr(c, r));
    return out;
  });

  /* ---------------- Die Tabelle ---------------- */
  class MiniCalc {
    /**
     * opts: { cols, rows, cells:{A1:"Text"|5|"=B5*B2"}, styles:{A4:"head"|"input"|"fix"|"label"},
     *         formats:{C:"eur", B2:"eur"}, editable:["C5"], select:"C5", actions:[{label, onClick, touch}], onChange,
     *         drag: true (Ausfüllkästchen ziehen, Strg+D/Strg+R), fillable:["D6:D9"] (zusätzliche Zielzellen) }
     * Ausfüllen geht nur in Zellen aus editable oder fillable. actions mit touch: true sieht man nur auf Touch-Geräten.
     */
    constructor(el, opts) {
      this.el = el;
      // decimal: "comma" = wie LibreOffice mit deutscher Einstellung (1.49 bleibt Text), "any" = Komma oder Punkt
      this.o = Object.assign({ cols: 4, rows: 10, cells: {}, styles: {}, formats: {}, editable: [], actions: [], decimal: "any" }, opts);
      // wie LibreOffice (deutsch): "0,85 €" wird als Zahl erkannt, "0.85" bleibt Text
      this.numRe = this.o.decimal === "comma" ? /^-?\d+(?:,\d+)?(?:\s*€)?$/ : /^-?\d+(?:[.,]\d+)?$/;
      this.raw = Object.assign({}, this.o.cells);
      this.initial = Object.assign({}, this.o.cells);
      this.editable = new Set(this.o.editable);
      this.fillable = new Set(expand(this.o.fillable));
      this.rng = null;   // markierter Bereich {c1, r1, c2, r2}; sel ist die aktive Zelle darin
      this.listeners = [];
      if (this.o.onChange) this.listeners.push(this.o.onChange);
      this.build();
      this.select(this.o.select || this.o.editable[0] || "A1", false);
    }

    on(fn) { this.listeners.push(fn); }
    emit(src) { this.listeners.forEach((fn) => fn(this, src)); }

    get(a) {
      // Ein Rechendurchgang pro render(): So zeigen Zufallszahlen und Formeln, die sie benutzen, dieselben Werte.
      const memo = this._memo || new Map();
      const stack = new Set();
      const val = (x) => {
        if (memo.has(x)) return memo.get(x);
        const raw = this.raw[x];
        let v;
        if (raw === undefined || raw === null || raw === "") v = null;
        else if (typeof raw === "number") v = raw;
        else if (typeof raw === "string" && raw.startsWith("=")) {
          if (stack.has(x)) return E.CIRC;
          stack.add(x);
          try { v = evaluate(raw.slice(1), val); } catch (e) { v = e instanceof CalcError ? e : E.SYN; }
          stack.delete(x);
        } else if (DATE_RE.test(String(raw).trim())) {
          const [d, m, y] = String(raw).trim().split(".").map(Number);
          v = serial(y < 100 ? 2000 + y : y, m, d);
        } else if (PCT_RE.test(String(raw).trim())) v = parseFloat(String(raw).replace(",", ".")) / 100;
        else if (this.numRe.test(String(raw).trim())) v = parseFloat(String(raw).replace(",", ".").replace("€", ""));
        else v = String(raw);
        memo.set(x, v);
        return v;
      };
      return val(a);
    }
    getRaw(a) {
      const r = this.raw[a];
      if (r === undefined || r === null) return "";
      return typeof r === "number" ? String(r).replace(".", ",") : String(r);  // deutsche Schreibweise
    }
    setFormat(a, f) { if (f) this.o.formats[a] = f; else delete this.o.formats[a]; this.render(); }
    set(a, value, src = "set") { this.raw[a] = value; this.render(); this.emit(src); }
    reset() { this.raw = Object.assign({}, this.initial); this.render(); this.select(this.o.select || this.o.editable[0] || "A1", false); this.emit("reset"); }

    format(a, v) {
      if (v === null) return "";
      if (v instanceof CalcError) return v.code;
      if (typeof v === "boolean") return v ? "WAHR" : "FALSCH";
      if (typeof v === "number") {
        let f = this.o.formats[a] || this.o.formats[a[0]];
        if (!f && PCT_RE.test(String(this.raw[a] || "").trim())) f = "pct";
        if (!f && DATE_RE.test(String(this.raw[a] || "").trim())) f = "date";
        if (f === "date") { const d = fromSerial(v); return [d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear()].map((x, i) => (i < 2 ? String(x).padStart(2, "0") : x)).join("."); }
        if (f === "eur") return fmtEUR.format(v);
        if (f === "plain") return String(v).replace(".", ",");   // ohne Tausenderpunkt, z. B. Jahreszahlen
        const pc = /^pct(\d?)$/.exec(f || "");   // Prozentformat: 0,2 → „20 %“
        if (pc) {
          const n = +(pc[1] || 0);
          return (v * 100).toLocaleString("de-DE", { minimumFractionDigits: n, maximumFractionDigits: n }) + " %";
        }
        const d = /^dec(\d)$/.exec(f || "");   // feste Nachkommastellen, z. B. "dec0" – rundet nur die Anzeige
        if (d) return v.toLocaleString("de-DE", { minimumFractionDigits: +d[1], maximumFractionDigits: +d[1] });
        return fmtNum.format(Math.round(v * 1e6) / 1e6);
      }
      return v;
    }

    build() {
      const o = this.o;
      this.el.classList.add("mc");
      this.el.innerHTML = "";
      const bar = document.createElement("div");
      bar.className = "mc-bar";
      bar.innerHTML = '<span class="mc-name" aria-label="Namenfeld"></span><span class="mc-fx" aria-hidden="true">ƒx</span>';
      this.nameEl = bar.querySelector(".mc-name");
      this.input = document.createElement("input");
      this.input.className = "mc-input";
      this.input.setAttribute("aria-label", "Eingabezeile");
      this.input.autocomplete = "off";
      this.input.spellcheck = false;
      this.input.setAttribute("autocapitalize", "off");
      bar.appendChild(this.input);
      this.el.appendChild(bar);

      this.refsEl = document.createElement("div");
      this.refsEl.className = "mc-refs";
      this.el.appendChild(this.refsEl);

      const scroll = document.createElement("div");
      scroll.className = "mc-scroll";
      const table = document.createElement("table");
      table.className = "mc-grid";
      let html = "<thead><tr><th></th>";
      for (let c = 1; c <= o.cols; c++) html += `<th scope="col">${colName(c)}</th>`;
      html += "</tr></thead><tbody>";
      for (let r = 1; r <= o.rows; r++) {
        html += `<tr><th scope="row">${r}</th>`;
        for (let c = 1; c <= o.cols; c++) {
          const a = addr(c, r);
          const st = o.styles[a] || "";
          html += `<td data-a="${a}" class="${st}${this.editable.has(a) ? " input" : ""}"></td>`;
        }
        html += "</tr>";
      }
      table.innerHTML = html + "</tbody>";
      scroll.appendChild(table);
      this.el.appendChild(scroll);
      this.table = table;
      this.tds = {};
      table.querySelectorAll("td").forEach((td) => { this.tds[td.dataset.a] = td; });
      if (o.drag) this.buildDrag(scroll);

      // Wie in Calc: Während man eine Formel tippt, fügt ein Klick auf eine Zelle deren Adresse ein.
      table.addEventListener("mousedown", (ev) => {
        const td = ev.target.closest("td");
        if (!td || !this.pointing()) return;
        ev.preventDefault();
        const inp = this.input, pos = inp.selectionStart ?? inp.value.length;
        inp.value = inp.value.slice(0, pos) + td.dataset.a + inp.value.slice(inp.selectionEnd ?? pos);
        const caret = pos + td.dataset.a.length;
        inp.setSelectionRange(caret, caret);
        this.showRefs(inp.value);
        this._skipClick = true;
        this._drag = { start: pos, len: td.dataset.a.length, anchor: td.dataset.a };
      });
      // Mit gedrückter Maustaste weiterziehen: aus B5 wird ein Bereich wie B5:B9.
      table.addEventListener("mouseover", (ev) => {
        const td = ev.target.closest("td");
        if (!td || !this._drag || !(ev.buttons & 1)) return;
        const A = parseAddr(this._drag.anchor), B = parseAddr(td.dataset.a);
        const text = this._drag.anchor === td.dataset.a ? td.dataset.a
          : addr(Math.min(A.c, B.c), Math.min(A.r, B.r)) + ":" + addr(Math.max(A.c, B.c), Math.max(A.r, B.r));
        const inp = this.input, d = this._drag;
        inp.value = inp.value.slice(0, d.start) + text + inp.value.slice(d.start + d.len);
        d.len = text.length;
        inp.setSelectionRange(d.start + d.len, d.start + d.len);
        this.showRefs(inp.value);
      });
      document.addEventListener("mouseup", () => { this._drag = null; });
      table.addEventListener("click", (ev) => {
        if (this._skipClick) { this._skipClick = false; return; }
        if (this._selDrag) return;
        const td = ev.target.closest("td");
        if (td) this.select(td.dataset.a, true);
      });
      this.input.addEventListener("input", () => { if (!this.input.readOnly) this.showRefs(this.input.value); });
      this.input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); this.commit(); }
        if (ev.key === "Escape") { this.input.value = this.getRaw(this.sel); }
      });
      this.input.addEventListener("blur", () => { if (this.editable.has(this.sel) && this.input.value !== this.getRaw(this.sel)) this.commit(); });

      if (o.actions.length) {
        const act = document.createElement("div");
        act.className = "mc-actions";
        o.actions.forEach((a) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn" + (a.secondary ? " secondary" : "") + (a.touch ? " mc-touch-only" : "");
          b.textContent = a.label;
          b.addEventListener("click", () => a.onClick(this, b));
          act.appendChild(b);
          a.el = b;
        });
        if (o.actions.some((a) => a.touch)) {
          const hint = document.createElement("p");
          hint.className = "mc-hint mc-touch-only";
          hint.innerHTML = T("📱 Zieh mit dem Finger am kleinen Quadrat unten rechts an der Zelle. Oder nimm den Knopf <strong>■</strong>. In LibreOffice Calc ziehst du am Ausfüllkästchen.");
          act.appendChild(hint);
        } else if (o.actions.some((a) => a.label.startsWith("■"))) {
          const hint = document.createElement("p");
          hint.className = "mc-hint";
          hint.innerHTML = T("ℹ️ Hier im Browser kannst du nicht mit der Maus ziehen. Nimm den Knopf <strong>■ … ausfüllen</strong>. In LibreOffice Calc ziehst du dann richtig am Ausfüllkästchen.");
          act.appendChild(hint);
        }
        this.el.appendChild(act);
      }
      this.render();
    }

    commit() {
      if (!this.editable.has(this.sel)) return;
      let v = this.input.value.trim();
      if (this.numRe.test(v)) v = parseFloat(v.replace(",", ".").replace("€", ""));
      this.raw[this.sel] = v;
      this.render();
      this.select(this.sel, false);
      this.emit("edit");
    }

    select(a, focus) {
      this.sel = a;
      const p = parseAddr(a);
      if (p) this.setRange(p, p);
      Object.values(this.tds).forEach((td) => td.classList.remove("sel"));
      if (this.tds[a]) this.tds[a].classList.add("sel");
      this.nameEl.textContent = a;
      this.input.value = this.getRaw(a);
      const editable = this.editable.has(a);
      this.input.readOnly = !editable;
      this.input.placeholder = editable ? T("Hier tippen und Enter drücken") : "";
      this.showRefs();
      if (focus && editable) { this.input.focus({ preventScroll: true }); this.input.select(); }
      if (this.o.onSelect) this.o.onSelect(this, a);   // z. B. Erklärung zur angeklickten Zelle
    }

    /** Tippt man gerade eine Formel und steht direkt vor dem Cursor ein Rechenzeichen oder =? */
    pointing() {
      const inp = this.input;
      if (document.activeElement !== inp || inp.readOnly || !inp.value.startsWith("=")) return false;
      const before = inp.value.slice(0, inp.selectionStart ?? inp.value.length).trimEnd();
      return /[=+\-*\/(;:^]$/.test(before);
    }

    showRefs(rawOverride) {
      Object.values(this.tds).forEach((td) => { td.removeAttribute("data-ref"); td.style.removeProperty("--refc"); });
      const raw = rawOverride !== undefined ? rawOverride : this.getRaw(this.sel);
      if (!raw.startsWith("=")) {
        this.refsEl.innerHTML = this.editable.has(this.sel)
          ? `<span class="t">${T("Klick in die Eingabezeile oben und tippe.")}</span>`
          : `<span class="t">${T("Klick eine Zelle an, um ihren Inhalt zu sehen.")}</span>`;
        return;
      }
      const refs = formulaRefs(raw);
      this.refsEl.innerHTML = `<span class="t">${T(refs.length ? "Diese Formel benutzt:" : "Keine Zellbezüge in der Formel.")}</span>`;
      refs.forEach((ref, i) => {
        const color = REF_COLORS[i % REF_COLORS.length];
        const b = document.createElement("b");
        b.style.color = color;
        b.textContent = ref.text;
        this.refsEl.appendChild(b);
        ref.cells.forEach((a) => {
          const td = this.tds[a];
          if (td) { td.setAttribute("data-ref", ""); td.style.setProperty("--refc", color); }
        });
        const empty = ref.cells.length === 1 && this.get(ref.cells[0]) === null && this.tds[ref.cells[0]];
        if (empty) {
          const s = document.createElement("span");
          s.textContent = T("← leer!");
          s.style.color = color;
          this.refsEl.appendChild(s);
        }
      });
    }

    render() {
      this._memo = new Map();
      for (const [a, td] of Object.entries(this.tds)) {
        const v = this.get(a);
        td.textContent = this.format(a, v);
        td.classList.toggle("num", typeof v === "number" || typeof v === "boolean");
        td.classList.toggle("err", v instanceof CalcError);
      }
      if (this.sel) this.showRefs();
      if (this.handle) this.placeBoxes();
    }

    /* ---------- Bereich markieren und Ausfüllkästchen ziehen ---------- */

    /** Markiert den Bereich von A bis B ({c, r}); die aktive Zelle (sel) bleibt, wie sie ist. */
    setRange(A, B) {
      this.rng = { c1: Math.min(A.c, B.c), r1: Math.min(A.r, B.r), c2: Math.max(A.c, B.c), r2: Math.max(A.r, B.r) };
      const g = this.rng, multi = g.c1 !== g.c2 || g.r1 !== g.r2;
      for (const [a, td] of Object.entries(this.tds)) {
        const q = parseAddr(a);
        td.classList.toggle("insel", multi && q.c >= g.c1 && q.c <= g.c2 && q.r >= g.r1 && q.r <= g.r2);
      }
      if (this.handle) this.placeBoxes();
    }
    /** Markierter Bereich als Text, z. B. "C7:E7" (eine Zelle: "C7"). */
    selection() {
      const g = this.rng;
      if (!g) return this.sel;
      const a = addr(g.c1, g.r1), b = addr(g.c2, g.r2);
      return a === b ? a : a + ":" + b;
    }
    canFill(a) { return this.editable.has(a) || this.fillable.has(a); }

    buildDrag(scroll) {
      this.el.classList.add("mc-drag");
      scroll.classList.add("mc-pos");
      this.selBox = document.createElement("div");
      this.selBox.className = "mc-selbox";
      this.fillBox = document.createElement("div");
      this.fillBox.className = "mc-fillbox";
      this.handle = document.createElement("div");
      this.handle.className = "mc-handle";
      this.handle.title = T("Ausfüllkästchen: ziehen zum Ausfüllen");
      scroll.append(this.selBox, this.fillBox, this.handle);
      scroll.tabIndex = -1;   // damit Strg+D auch ankommt, wenn eine feste Zelle markiert ist
      this.scrollEl = scroll;
      if (window.ResizeObserver) new ResizeObserver(() => this.placeBoxes()).observe(this.table);

      // Mit der Maus über mehrere Zellen ziehen markiert einen Bereich (am Handy scrollt der Finger die Seite).
      this.table.addEventListener("pointerdown", (ev) => {
        const td = ev.target.closest("td");
        if (!td || ev.pointerType === "touch" || ev.button !== 0 || this.pointing()) return;
        const p = parseAddr(td.dataset.a);
        if (ev.shiftKey) {
          ev.preventDefault();
          this.setRange(parseAddr(this.sel), p);
          this._skipClick = true;
          this.focusGrid();
          return;
        }
        this._selDrag = { start: p, moved: false };
      });
      document.addEventListener("pointermove", (ev) => {
        const d = this._selDrag;
        if (!d || !(ev.buttons & 1)) return;
        const p = this.cellAt(ev.clientX, ev.clientY);
        if (!d.moved && p.c === d.start.c && p.r === d.start.r) return;
        if (!d.moved) { d.moved = true; this.select(addr(d.start.c, d.start.r), false); }
        this.setRange(d.start, p);
      });
      document.addEventListener("pointerup", () => {
        const d = this._selDrag;
        this._selDrag = null;
        if (d && d.moved) { this._skipClick = true; this.focusGrid(); }
        else if (d && d.nearHandle) this.select(addr(d.start.c, d.start.r), true);   // nur ein Klick neben das Kästchen
      });

      // Das Ausfüllkästchen
      const h = this.handle;
      h.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        // Mit der Maus zählt nur das sichtbare Kästchen (+2 px). Knapp daneben wird ganz normal markiert,
        // damit man nicht aus Versehen ausfüllt. Für den Finger bleibt die Fläche groß.
        if (ev.pointerType !== "touch") {
          const b = h.getBoundingClientRect();
          if (ev.clientX < b.left - 2 || ev.clientY < b.top - 2) {
            ev.preventDefault();
            ev.stopPropagation();
            this.commitPending();
            this._selDrag = { start: this.cellAt(ev.clientX, ev.clientY), moved: false, nearHandle: true };
            return;
          }
        }
        ev.preventDefault();
        ev.stopPropagation();
        this.commitPending();
        try { h.setPointerCapture(ev.pointerId); } catch (e) { /* z. B. nachgestellte Ereignisse im Test */ }
        this._fd = { plan: null };
        this.el.classList.add("mc-filling");
      });
      h.addEventListener("pointermove", (ev) => {
        if (!this._fd) return;
        this._fd.plan = this.planFill(this.cellAt(ev.clientX, ev.clientY));
        this.showFillBox(this._fd.plan);
      });
      const end = (ev, cancel) => {
        const fd = this._fd;
        if (!fd) return;
        this._fd = null;
        this.el.classList.remove("mc-filling");
        this.showFillBox(null);
        if (!cancel && fd.plan && fd.plan.n > 0) this.fillBy(fd.plan.dir, fd.plan.n, ev.ctrlKey || ev.metaKey, "drag");
      };
      h.addEventListener("pointerup", (ev) => end(ev, false));
      h.addEventListener("pointercancel", (ev) => end(ev, true));
      h.addEventListener("click", (ev) => ev.stopPropagation());

      // Tastatur wie in LibreOffice Calc: Strg+D füllt nach unten aus (kopiert die oberste Zeile, zählt nicht hoch;
      // ist nur eine Zeile markiert, holt es die Zeile darüber). Für „nach rechts“ hat Calc kein Kürzel.
      // Umschalt+Pfeil markiert einen Bereich.
      this.el.addEventListener("keydown", (ev) => {
        const k = ev.key.toLowerCase();
        if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && k === "d") {
          ev.preventDefault();   // sonst setzt der Browser ein Lesezeichen
          this.commitPending();
          const g = this.rng, keep = { ...g };
          if (g.r2 > g.r1) this.fillBy("down", g.r2 - g.r1, true, "key", { c1: g.c1, r1: g.r1, c2: g.c2, r2: g.r1 });
          else if (g.r1 > 1) {
            this.fillBy("down", 1, true, "key", { c1: g.c1, r1: g.r1 - 1, c2: g.c2, r2: g.r1 - 1 });
            this.select(addr(keep.c1, keep.r1), false);
            this.setRange({ c: keep.c1, r: keep.r1 }, { c: keep.c2, r: keep.r2 });
          }
          return;
        }
        const dirs = { arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] };
        const mv = dirs[k];
        if (!mv) return;
        const inInput = ev.target === this.input;
        if (inInput && !(ev.shiftKey && mv[0] === 0)) return;   // im Eingabefeld bewegen ← → den Cursor
        ev.preventDefault();
        if (inInput) this.commitPending();
        const g = this.rng, s = parseAddr(this.sel);
        const clampC = (c) => Math.max(1, Math.min(this.o.cols, c)), clampR = (r) => Math.max(1, Math.min(this.o.rows, r));
        if (ev.shiftKey) {
          // das andere Ende des Bereichs verschieben (die aktive Zelle bleibt fest)
          const far = { c: g.c1 === s.c ? g.c2 : g.c1, r: g.r1 === s.r ? g.r2 : g.r1 };
          this.setRange(s, { c: clampC(far.c + mv[0]), r: clampR(far.r + mv[1]) });
          this.focusGrid();
        } else {
          this.select(addr(clampC(s.c + mv[0]), clampR(s.r + mv[1])), true);
          if (!this.editable.has(this.sel)) this.focusGrid();
        }
      });
    }

    focusGrid() { if (this.scrollEl && document.activeElement !== this.scrollEl) this.scrollEl.focus({ preventScroll: true }); }
    /** Getippte, aber noch nicht mit Enter bestätigte Eingabe übernehmen. */
    commitPending() { if (this.editable.has(this.sel) && this.input.value !== this.getRaw(this.sel)) this.commit(); }

    /** Zelle unter dem Punkt (x, y); außerhalb der Tabelle die nächstgelegene Randzelle. */
    cellAt(x, y) {
      let c = this.o.cols, r = this.o.rows;
      for (let i = 1; i <= this.o.cols; i++) if (x < this.tds[addr(i, 1)].getBoundingClientRect().right) { c = i; break; }
      for (let i = 1; i <= this.o.rows; i++) if (y < this.tds[addr(1, i)].getBoundingClientRect().bottom) { r = i; break; }
      return { c, r };
    }

    /** Wohin und wie weit würde ausgefüllt, wenn man das Kästchen bei Zelle p loslässt? Bleibt vor gesperrten Zellen stehen. */
    planFill(p) {
      const g = this.rng;
      const dr = p.r > g.r2 ? p.r - g.r2 : p.r < g.r1 ? p.r - g.r1 : 0;
      const dc = p.c > g.c2 ? p.c - g.c2 : p.c < g.c1 ? p.c - g.c1 : 0;
      if (!dr && !dc) return null;
      const vertical = Math.abs(dr) >= Math.abs(dc);
      const dir = vertical ? (dr > 0 ? "down" : "up") : (dc > 0 ? "right" : "left");
      const want = Math.abs(vertical ? dr : dc);
      let n = 0;
      while (n < want && this.lineCells(dir, n + 1).every((a) => this.canFill(a))) n++;
      return { dir, n, want };
    }
    /** Die Zellen der k-ten neuen Zeile bzw. Spalte neben dem markierten Bereich. */
    lineCells(dir, k, g = this.rng) {
      const out = [];
      if (dir === "down" || dir === "up") {
        const r = dir === "down" ? g.r2 + k : g.r1 - k;
        for (let c = g.c1; c <= g.c2; c++) out.push(r >= 1 && r <= this.o.rows ? addr(c, r) : "");
      } else {
        const c = dir === "right" ? g.c2 + k : g.c1 - k;
        for (let r = g.r1; r <= g.r2; r++) out.push(c >= 1 && c <= this.o.cols ? addr(c, r) : "");
      }
      return out;
    }

    /** Rahmen um den Bereich und das Kästchen an die richtige Stelle setzen. */
    placeBoxes() {
      const g = this.rng;
      if (!g || !this.tds[addr(g.c1, g.r1)]) return;
      const box = (el, A, B) => {
        const a = this.tds[A], b = this.tds[B];
        el.style.left = a.offsetLeft + "px";
        el.style.top = a.offsetTop + "px";
        el.style.width = b.offsetLeft + b.offsetWidth - a.offsetLeft + "px";
        el.style.height = b.offsetTop + b.offsetHeight - a.offsetTop + "px";
      };
      const A = addr(g.c1, g.r1), B = addr(g.c2, g.r2);
      box(this.selBox, A, B);
      this.selBox.hidden = A === B;
      const b = this.tds[B];
      this.handle.style.left = b.offsetLeft + b.offsetWidth + "px";
      this.handle.style.top = b.offsetTop + b.offsetHeight + "px";
    }
    showFillBox(plan) {
      const g = this.rng, fb = this.fillBox;
      if (!plan || !plan.n) { fb.style.display = "none"; return; }
      const e = { ...g };
      if (plan.dir === "down") e.r2 += plan.n; if (plan.dir === "up") e.r1 -= plan.n;
      if (plan.dir === "right") e.c2 += plan.n; if (plan.dir === "left") e.c1 -= plan.n;
      const a = this.tds[addr(e.c1, e.r1)], b = this.tds[addr(e.c2, e.r2)];
      Object.assign(fb.style, { display: "block", left: a.offsetLeft + "px", top: a.offsetTop + "px",
        width: b.offsetLeft + b.offsetWidth - a.offsetLeft + "px", height: b.offsetTop + b.offsetHeight - a.offsetTop + "px" });
    }

    /**
     * Füllt vom Bereich src (Standard: die Markierung) n Zeilen/Spalten in Richtung dir aus – wie in Calc:
     * Formeln werden angepasst, Zahlen/Wochentage/Monate/Datum/„Text 3“ als Reihe fortgesetzt (copy = true: nur kopieren).
     * Danach ist der ganze Bereich markiert. via: "drag" | "key" | "button" (steht danach in lastFill).
     */
    fillBy(dir, n, copy = false, via = "button", src = this.rng) {
      const vertical = dir === "down" || dir === "up", sign = dir === "down" || dir === "right" ? 1 : -1;
      // Startzellen je Spalte (beim Ziehen nach unten/oben) bzw. je Zeile, in Ziehrichtung sortiert
      const lines = [];
      if (vertical) for (let c = src.c1; c <= src.c2; c++) { const l = []; for (let r = src.r1; r <= src.r2; r++) l.push(addr(c, r)); lines.push(l); }
      else for (let r = src.r1; r <= src.r2; r++) { const l = []; for (let c = src.c1; c <= src.c2; c++) l.push(addr(c, r)); lines.push(l); }
      if (sign < 0) lines.forEach((l) => l.reverse());
      const targets = [];
      lines.forEach((line, li) => {
        const vals = line.map((a) => this.raw[a] ?? "");
        const k = line.length;
        for (let i = 1; i <= n; i++) {
          const t = this.lineCells(dir, i, src)[li];
          if (!t || !this.canFill(t)) continue;
          // eine Startzelle: nach oben/links zählt die Reihe rückwärts; mehrere: Reihenfolge ist schon umgedreht
          const ser = copy ? null : seriesStep(vals, k === 1 ? sign * i : i);
          let v;
          if (ser !== null) v = ser;
          else {
            const s = line[(i - 1) % k], raw = this.raw[s];
            const ps = parseAddr(s), pt = parseAddr(t);
            v = typeof raw === "string" && raw.startsWith("=") ? shiftFormula(raw, pt.r - ps.r, pt.c - ps.c) : raw;
          }
          this.raw[t] = v;
          targets.push(t);
        }
      });
      const e = { ...src };
      if (dir === "down") e.r2 += n; if (dir === "up") e.r1 -= n;
      if (dir === "right") e.c2 += n; if (dir === "left") e.c1 -= n;
      e.c1 = Math.max(1, e.c1); e.r1 = Math.max(1, e.r1); e.c2 = Math.min(this.o.cols, e.c2); e.r2 = Math.min(this.o.rows, e.r2);
      this.render();
      this.select(addr(src.c1, src.r1), false);   // wie in Calc: aktive Zelle oben links, der ganze Bereich markiert
      this.setRange({ c: e.c1, r: e.r1 }, { c: e.c2, r: e.r2 });
      targets.forEach((t) => { const td = this.tds[t]; if (td) { td.classList.remove("flash"); void td.offsetWidth; td.classList.add("flash"); } });
      this.lastFill = { source: src, dir, n, targets, via, copy };
      if (via !== "button") this.focusGrid();
      this.emit("fill");
      return targets;
    }

    /** Ausfüllen: kopiert die Formel aus src in alle Zielzellen (mit Animation). */
    async fill(src, targets, delay = 260) {
      const s = parseAddr(src);
      const raw = this.getRaw(src);
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      for (const t of targets) {
        const p = parseAddr(t);
        this.raw[t] = raw.startsWith("=") ? shiftFormula(raw, p.r - s.r, p.c - s.c) : this.raw[src];
        this.render();
        const td = this.tds[t];
        if (td) { td.classList.remove("flash"); void td.offsetWidth; td.classList.add("flash"); }
        if (!reduce && delay) await new Promise((r) => setTimeout(r, delay));
      }
      this.emit("fill");
    }

    range(a, b) {
      const A = parseAddr(a), B = parseAddr(b), out = [];
      for (let r = A.r; r <= B.r; r++) for (let c = A.c; c <= B.c; c++) out.push(addr(c, r));
      return out;
    }
  }

  MiniCalc.shiftFormula = shiftFormula;
  MiniCalc.formulaRefs = formulaRefs;
  MiniCalc.CalcError = CalcError;
  MiniCalc.evaluate = evaluate;
  window.MiniCalc = MiniCalc;
})();
