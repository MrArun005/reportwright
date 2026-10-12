# PDF/A and accessible PDF (PDF/UA)

Make a PDF for long-term archive (PDF/A-2b) or for screen readers (PDF/UA-1). Use PDF/A for records you must keep. Use PDF/UA for documents that must be accessible.

## In the UI

1. Open the report in the viewer (`/viewer/<id>`).
2. Click the **Export options** button (⚙).
3. Tick **PDF/A (for archiving)** and/or **Accessible PDF (PDF/UA)**. The hint says: "Tagged for screen readers: headings, tables, reading order, alt text".
4. Click **PDF** in the **Export** group.

The option is kept in your browser. Other viewers choose their own.

Designers can add alternative text to images and items in the Inspector (label "Alternative text (screen readers: accessible PDF, Word)").

## From the CLI

```bash
pw render orders.pw.json -d orders=orders.json --pdfa --ua -o orders.pdf
pw render orders.pw.json -d orders=orders.json --pdfa -o orders-archive.pdf
```

- `--pdfa`: PDF/A-2b. With `--ua` it is PDF/A-2a.
- `--ua`: accessible PDF, PDF/UA-1.
- Both apply to `-f pdf` only.

## Through the API

Needs an API key. Add the fields to the body of `POST /api/v1/render` (or to a batch):

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","parameters":{"accountId":"LN-2025-001982"},"pdfa":true,"ua":true}' \
  -D headers.txt -o statement-archive.pdf
```

- `"pdfa": true`: PDF/A-2b. With `"ua": true` it is PDF/A-2a.
- `"ua": true`: accessible PDF (PDF/UA-1).

The server link also takes query flags: `GET /api/reports/<id>/pdf?pdfa=1` and `?ua=1` (uses the app sign-in).

## Notes

- PDF/A forbids encryption. A PDF/A request with a password (or with `sign`) is refused with 400. See [passwords-and-permissions](passwords-and-permissions.md).
- The sample loan statement passes veraPDF 1.30 (PDF/A-2B profile), signed and unsigned (`README.md`).
- The engine's PDF/UA-1 output is validated with veraPDF (`packages/engine/README.md`).
- The PDF/A file gets XMP metadata and the sRGB output intent (`public/icc`).
