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

## Engine memory and streaming layout (2026-10-05)

What changed in the engine (commits 0219a7a, 6d8562f): page assembly now moves a table row's freshly painted
items into place instead of copying them, and `layoutItems` places units in place, so the page model exists once
during a render instead of twice. One 50,000-row render (S1): peak RSS 582 MB → 417 MB; the model itself is
~220 MB live (text items with their line, clip and Word cell tag ~180 MB, export regions ~40 MB).

pw-bench (`--profile=fast`, pw-node, one process for first page + pagination + PDF; machine under load 13–18):
peak RSS 829 MB (S1) and 927 MB (S2) against Jasper's 860 / 730 MB. Before (earlier runs, same profile): 770–1,106 MB (S1) and 858–1,378 MB (S2); one run each is too few to call it settled. What remains is
mostly the previous run's model still waiting for a major GC when the next render starts, plus the export's
+200 MB (above).

Streaming layout (release pages as they are exported) was **not built**, because it is not tractable through the
current public API without a redesign:

- `render()` lays out the whole body as one strip, then paginates it. Pages are cut from units that already exist,
  so handing pages over as they are assembled frees nothing: the units hold the same items.
- Real streaming needs layout itself to run in page-sized steps (lay out rows until the page is full, paginate,
  emit, drop), with tables carrying their running state (groups, running values, merged cells, repeated
  headers) across steps.
- Page N of M: M is known only at the end. Either a second, measuring pass (layout without painting: cheap, the
  painting is most of the memory) or placeholders filled at the end (the PDF writer would have to keep the page
  streams with "of M" open, which is what Jasper does with its "Report" evaluation time).
- Table of contents: its page numbers come from the pass that found the entries; the measuring pass above gives
  them too, so the TOC pass becomes that pass.
- Drill-down / toggles: unaffected (state is an input to the render).
- `exportPdf` subsets fonts before writing pages, so it needs every character first: the measuring pass can
  collect them (characters per font key), or fonts are written last (see "What streaming would mean").

Plan, if wanted: (1) a measuring pass that returns page count, TOC entries and character sets without painting;
(2) `render(def, { onPage })` that lays out and paints one page at a time from table state kept between pages;
(3) `writePdf(pageIterator, sink)` as above. Option-gated; the default stays the whole model.

Smaller model without streaming (changes the model's shape, so exporters and viewers change with it): build the
export regions (xlsx/csv) and the Word cell tags only when that export asks for them (~90 MB of the 220 MB), and
keep positions of text lines in typed arrays per page.

## Peak memory in the bench harness (2026-10-05, later)

Why the harness peak was 1.1–1.5 GB with a ~220 MB model: one process renders the first page, the full report and
the PDF twice, and V8 only collects the dead models when the old generation reaches about 4× what was live at the
previous full GC (taken mid-export, model alive). So the peak follows the live model size roughly ×4, plus the
export's native memory. Nothing in the engine holds a finished model: after a GC the heap is back to ~25 MB.

What changed (S2, 963 pages, Node 22):

| | before | after |
|---|---|---|
| model, plain render (heap after GC) | 222 MB (table data and cell tags always) | 116 MB (`exportData` opt-in; whole-number fields unboxed) |
| model with `exportData: true` | 222 MB | 193 MB (cell tag in the text literal; shapes) |
| export, native memory | ~250 MB (963 zlib jobs started at once) | ~80 MB (4 at a time, pages compress while the next are drawn) |
| harness peak RSS (S1/S2, quiet machine) | 1,080–1,530 MB | ~700–830 MB |
| harness pagination / PDF end to end | 540–600 / 1,030–1,220 ms | 450–530 / 920–1,020 ms |

Done from the plan above: export regions and cell tags only on request. Not done: typed arrays for line positions
(a model shape change for every exporter and viewer), streaming layout. A text item is now ~290 bytes (item, lines
array, line, clip, boxed fractions); below that needs the shape change.
