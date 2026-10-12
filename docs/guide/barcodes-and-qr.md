# Barcodes and QR codes

Print barcodes and QR codes from a field: a product code, a tracking number, a payment link. Use them on labels, statements and tickets. A QR code can open a web link when clicked in the viewer or the PDF.

## In the UI

Designer (`/designer/<id>`):

1. Open the **Insert** group and drag **Barcode** onto the page.
2. In the **Inspector**, pick the symbology. There are 49, with their usual names: Code 128, GS1-128, EAN-13, UPC-A, ITF-14, Codabar, QR Code, Data Matrix, PDF417, Aztec and more.
3. Set the value to a field, for example `=Fields.code`.
4. Open the **Barcode options** category for the options: caption position, quiet zone, rotation, and symbology-specific settings.
5. To make it a link, set an action on the barcode (web link, bookmark jump or drill-through).

## From the CLI

Barcodes are part of the report. `pw render` draws them as vectors:

```bash
pw render reports/loan-statement.pw.json -f pdf -o statement.pdf
```

## Through the API

Barcodes are drawn when a report renders. Use `POST /api/v1/render` with the report's template, as in [charts-and-sparklines](charts-and-sparklines.md).

## Notes

Options are checked against their list or range before they reach the barcode library. Anything else is ignored (`docs/API.md`, Barcodes).

| Key | For | Values |
|---|---|---|
| `captionPosition` | linear codes | `below` (default), `above`; `showText: false` hides it |
| `quietZone` | all | points of white inside the box |
| `rotate` | all | `0`, `90`, `180`, `270` |
| `qrErrorLevel`, `qrVersion`, `qrMask` | QR | `L`/`M`/`Q`/`H`, 1–40, 1–8 |
| `dmShape`, `dmSize` | Data Matrix | `square`/`rectangle`, `"24x24"` |
| `pdfColumns`, `pdfRows`, `pdfErrorLevel`, `pdfCompact` | PDF417 | 1–30, 3–90, 0–8, true |
| `aztecLayers`, `aztecErrorPercent` | Aztec | 1–32, 5–95 |
| `maxiMode` | MaxiCode | 2–6 |
| `checkDigit`, `barRatio` | Code 39, Code 93, Interleaved 2 of 5, Codabar, Code 11, MSI | true, 2–3 |

- A value longer than the symbology holds is refused with an error on the page. QR holds 7,089 characters. Most linear codes hold 128.
- 2D codes keep their aspect ratio and are centred, so a QR code stays square.
- Any other bwip-js id still works in the report JSON.
