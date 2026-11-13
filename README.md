# Calc-Kurs – Learning spreadsheets with LibreOffice Calc

🇩🇪 [Deutsche Version](README.de.md)

A free learning path for **LibreOffice Calc**, made for lower secondary school (Mittelschule) in Bavaria, Germany, grades 8 and 9.

**Live:** https://calc.herrseibert.de

> The course itself is in **German**. Function names follow the German version of LibreOffice
> (e.g. `SUMME` = SUM, `WENN` = IF, `SVERWEIS` = VLOOKUP, `ZÄHLENWENN` = COUNTIF).

## Contents

| Folder | What's inside? |
|---|---|
| `index.html` | Course overview |
| `k8/` | Grade 8: first steps, formulas, functions, fill handle, absolute references, charts, project "class trip" |
| `k9/` | Grade 9: error detective, percentages, IF (3 parts), conditional formatting (2 parts), exam preparation |
| `extra/` | Optional add-on modules (e.g. COUNTIF, VLOOKUP, dates, text, random numbers) |
| `downloads/` | Exercise files (`.ods`) with matching solutions (`-LOESUNG.ods`) |
| `assets/` | Styles, scripts (mini spreadsheet, charts, quizzes) and language support |

The exercise files check themselves: control cells show whether a formula is right.

**Language support:** The pages are in German. Learners can show translations
(e.g. English, Ukrainian, Arabic, Russian) – helpful for students learning German as a second language.
Calc terms stay in German, because that is what they see in the program.

## Usage

The site is fully static – no external fonts, no cookies, no tracking.
To view it locally, run this in the downloaded folder:

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765 in your browser.

Tested with LibreOffice 24.2.

## License

[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) – free to use, adapt and share,
with attribution and under the same license. Full text in [`LICENSE`](LICENSE).

Created with the AI Claude by Anthropic.
