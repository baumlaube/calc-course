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

  /* ---------------- Die Tabelle ---------------- */
  class MiniCalc {
    /**
     * opts: { cols, rows, cells:{A1:"Text"|5|"=B5*B2"}, styles:{A4:"head"|"input"|"fix"|"label"},
     *         formats:{C:"eur", B2:"eur"}, editable:["C5"], select:"C5", actions:[{label, onClick}], onChange }
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
      this.tds = {};
      table.querySelectorAll("td").forEach((td) => { this.tds[td.dataset.a] = td; });

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
          b.className = "btn" + (a.secondary ? " secondary" : "");
          b.textContent = a.label;
          b.addEventListener("click", () => a.onClick(this, b));
          act.appendChild(b);
          a.el = b;
        });
        if (o.actions.some((a) => a.label.startsWith("■"))) {
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
