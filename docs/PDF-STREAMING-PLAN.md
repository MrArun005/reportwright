# Plan: writing PDFs page by page (streaming)

Status: **not built**. The bounded wins landed instead (commits d5c4182 and 5724ca1). This file says what
streaming would take and what it would buy, so the decision can be made later with numbers.

## Where things are now

`exportPdf` (src/exporters/pdf.js) walks the finished page model once:

1. collects the characters each font draws (subsetting needs the whole set before any font is written);
2. writes each page's operators as one string (graphics state tracked, shared Resources dictionary);
3. compresses every page stream (Node: zlib on the thread pool; browsers: CompressionStream);
4. hands the object graph to pdf-lib, which embeds fonts and images, then serialises everything into one
   buffer (`PDFStreamWriter`: object streams + a cross-reference stream).

Measured on the 963-page grouped report (pw-bench S2, 50,000 rows, Node 22, M2):

| | |
|---|---|
| render (pagination) | ~1.3 s, heap after render ~256 MB, RSS ~590 MB |
| exportPdf | ~0.6 s, RSS peak ~780 MB (+~200 MB) |
| file | 2.4 MB |

So the export now adds about 200 MB and 0.6 s on top of a model that is already fully in memory. Streaming the
PDF alone cannot remove the model; it can only remove the export's own +200 MB and the final copy.

## What streaming would mean

Write each page's objects to a sink (`WritableStream` in browsers, a Node stream / response on the server) as
soon as they are made, keep only offsets, and write fonts, the page tree, the outline and the cross-reference
section at the end.

1. **Reserve references up front**: the page tree root, the shared Resources dictionary, one ref per font key
   (the keys are known from the model before any page is written), one per page and per content stream.
   pdf-lib's `context.nextRef()` already does this; outline and link destinations only need page refs.
2. **Our own writer** for the file skeleton: header, `n 0 obj … endobj` per object with its byte offset, and
   at the end a classic xref table or an xref stream (no object streams for page objects, or batch them in
   fixed groups as they are written). pdf-lib objects can still be serialised one at a time with
   `PDFObject.sizeInBytes()` / `copyBytesInto()`.
3. **Fonts last**: subsets are made after the page loop (the character sets are known from the model already,
   so they could also be made first; either way the font objects go after the pages).
4. **Images**: embed on first use and write immediately (pdf-lib's `PDFImage.embed()` then serialise its ref).
5. **Forms, signatures, PDF/A, encryption** — the features that need care:
   - *Forms*: AcroForm and widget appearances are built by pdf-lib; write them at the end (widgets are
     annotations referenced from page dictionaries, so the page dictionary needs their refs reserved, or pages
     with fields are written last).
   - *Signatures*: the signer post-processes the final bytes (placeholder, byte ranges), so it already needs the
     whole file; streaming would buffer when `sign` is on. Keep that path non-streaming.
   - *PDF/A*: metadata, output intent and the file ID are document-level objects written at the end; the
     annotation print flags are set when each annotation is written. Straightforward.
   - *Encryption*: AES per object is possible while streaming (each object's key is the file key; strings and
     streams are encrypted as written), but `encrypt.js` walks pdf-lib's graph today. A streaming path would
     need its own per-object encryption, or keep encryption non-streaming.
6. **Callers**: the server's `/api/v1` render could pipe straight to the response; the viewer's export would
   build a `Blob` from chunks (no gain in memory there, a small one in time).

## Expected gain, honestly

- Memory: about −200 MB peak on the 963-page report (the export's share); nothing on the model's ~590 MB.
  Bigger wins need the engine to hand pages over as it paginates (render already supports `firstPages`;
  a page-at-a-time callback from `render()` plus streaming PDF would make memory flat in page count).
- Time: small. Serialisation is no longer the bottleneck (export is ~0.6 s of ~2 s end to end); the final
  buffer copy is tens of milliseconds.
- Time to first byte for an HTTP response: real — the first pages could leave before the last are drawn.

## Suggested order, if it is wanted

1. Page-at-a-time `render()` callback (engine), behind an option.
2. A `writePdf(model | pageIterator, sink)` that covers plain reports (text, shapes, images, links, outline).
3. Fall back to today's `exportPdf` for fields, signing and encryption until each has its streaming version.
4. Tests: byte-identical text positions (`scripts/check-pdf-matches-model.mjs`), veraPDF for PDF/A, qpdf/poppler
   `--check` on streamed files, and a memory budget test on a 10,000-page report.
