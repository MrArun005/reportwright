#!/usr/bin/env python3
"""Python contestants (and pdfium through pypdfium2): python3 harness.py <lib> <job> <size> <outdir> -> one JSON line.

The same contract as common/frame.mjs: inputs are read before the clock starts; `ms` is the job in this process;
REPS=n runs it n times (`warm_ms`: the median of the last 40). Each library is imported only when asked for.
Low-level writers (ReportLab's canvas, PyMuPDF) draw the create jobs through the same operations (Canvas jobs below,
a port of common/canvas-jobs.mjs); WeasyPrint prints fixtures/html/*.html, the files Puppeteer prints.
"""
import io, json, os, shutil, statistics, struct, sys, time, traceback
from importlib.metadata import version as pkg_version
from pathlib import Path

FX = Path(os.environ.get('BENCH_FIXTURES', '.'))
SPEC = json.loads(Path(os.environ.get('BENCH_SPEC', FX / 'spec.json')).read_text())
P, R = SPEC['page'], SPEC['report']
BOTTOM = P['h'] - P['margin'] - P['footer']


def fx(p):
    return str(FX / p)


def font(k):
    return fx(SPEC['fonts'][k])


def money(x):
    return f'{x:,.2f}'


def rgb01(h):
    return tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))


def img_size(path):
    """(width, height) from a PNG or JPEG header, without decoding the image."""
    b = open(path, 'rb').read(1 << 16)
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', b[16:24])
    i = 2
    while i < len(b):
        m, ln = b[i + 1], struct.unpack('>H', b[i + 2:i + 4])[0]
        if 0xC0 <= m <= 0xCF and m not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack('>HH', b[i + 5:i + 9])
            return w, h
        i += 2 + ln
    raise ValueError('image size')


def read_rows(n):
    rows = []
    with open(fx(f'rows-{n}.csv')) as f:
        next(f)
        for line in f:
            c = line.rstrip('\n').split(',')
            rows.append((int(c[0]), c[1], c[2], c[3], c[4], float(c[5]), c[6]))
    return rows


def groups_of(rows):
    out = []
    for r in rows:
        if not out or out[-1]['region'] != r[2]:
            out.append({'region': r[2], 'rows': [], 'count': 0, 'sum': 0.0})
        g = out[-1]
        g['rows'].append(r)
        g['count'] += 1
        g['sum'] += r[5]
    return out


# ---------------------------------------------------------------- the create jobs over a drawing surface
def plan(rows):
    pages, y = [], 0
    cur = None

    def new_page():
        nonlocal cur, y
        cur = []
        pages.append(cur)
        y = P['margin'] + R['headH']

    def need(h):
        if y + h > BOTTOM:
            new_page()
    new_page()
    count, total = 0, 0.0
    for g in groups_of(rows):
        need(R['groupH'] + R['rowH'])
        cur.append(('G', y, g['region']))
        y += R['groupH']
        for r in g['rows']:
            need(R['rowH'])
            cur.append(('R', y, r))
            y += R['rowH']
        need(R['rowH'])
        cur.append(('S', y, 'Region total', g['count'], g['sum']))
        y += R['rowH']
        count, total = count + g['count'], total + g['sum']
    need(R['rowH'])
    cur.append(('S', y, 'Grand total', count, total))
    return pages


def cells(cv, y, h, vals, bold):
    x, f = P['margin'], 'b' if bold else 'r'
    for c, v in zip(R['cols'], vals):
        if v:
            cv.text(v, x + c['w'] - 2 - cv.width(v, R['size'], f) if c['right'] else x + 2, y + (h - R['size']) / 2, R['size'], f)
        x += c['w']


def job_plain(cv_open, ctx, out):
    s, pool = SPEC['plain'], ctx['pool']
    cv = cv_open(out, ['r'], 'Plain')
    for p in range(ctx['pages']):
        cv.page()
        for k in range(s['linesPerPage']):
            cv.text(pool[(p * s['linesPerPage'] + k) % len(pool)], s['x'], s['y'] + k * s['leading'], s['size'], 'r')
    cv.end()


def job_report(cv_open, ctx, out):
    cv = cv_open(out, ['r', 'b'], 'Ledger')
    pages, W, m = plan(ctx['rows']), sum(c['w'] for c in R['cols']), P['margin']
    for i, ops in enumerate(pages):
        cv.page()
        cv.rect(m, m, W, R['headH'], R['headBg'])
        cells(cv, m, R['headH'], [c['label'] for c in R['cols']], True)
        for o in ops:
            if o[0] == 'G':
                cv.rect(m, o[1], W, R['groupH'], R['groupBg'])
                cv.text(f'Region {o[2]}', m + 2, o[1] + 3.5, R['size'], 'b')
            elif o[0] == 'R':
                r = o[2]
                cells(cv, o[1], R['rowH'], [str(r[0]), r[1], r[2], r[3], r[4], money(r[5]), r[6]], False)
                cv.hline(m, m + W, o[1] + R['rowH'], 0.5, R['rule'])
            else:
                cells(cv, o[1], R['rowH'], [o[2], '', str(o[3]), '', '', money(o[4]), ''], True)
        f = R['footerText'].replace('{n}', str(i + 1)).replace('{m}', str(len(pages)))
        cv.text(f, m + W - cv.width(f, R['footerSize'], 'r'), BOTTOM + 4, R['footerSize'], 'r')
    cv.end()
    return f'{len(pages)} pages'


def job_invoice(cv_open, ctx, out, pdfa=False):
    I = SPEC['invoice']
    T = I['table']
    cv = cv_open(out, ['r', 'b'], 'Invoice', pdfa)
    cv.page()
    for t in I['texts']:
        f = 'b' if t['bold'] else 'r'
        cv.text(t['text'], t['x'] + t['w'] - cv.width(t['text'], t['size'], f) if t['right'] else t['x'], t['y'], t['size'], f)
    L = I['logo']
    cv.draw(cv.image(fx(L['file'])), L['x'], L['y'], L['w'], L['h'])
    W = sum(c['w'] for c in T['cols'])

    def row(y, vals, bold):
        x, f = T['x'], 'b' if bold else 'r'
        for c, v in zip(T['cols'], vals):
            if v:
                cv.text(v, x + c['w'] - 2 - cv.width(v, T['size'], f) if c['right'] else x + 2, y + 5, T['size'], f)
            x += c['w']
    y = T['y']
    cv.rect(T['x'], y, W, T['rowH'], R['headBg'])
    row(y, [c['label'] for c in T['cols']], True)
    y += T['rowH']
    for r in T['rows']:
        row(y, r, False)
        cv.hline(T['x'], T['x'] + W, y + T['rowH'], 0.5, R['rule'])
        y += T['rowH']
    for i, (l, v) in enumerate(T['totals']):
        row(y, ['', '', l, v], i == 2)
        y += T['rowH']
    cv.end()


def job_unicode(cv_open, ctx, out):
    U = SPEC['unicode']
    cv = cv_open(out, [l['font'] for l in U['lines']], 'Unicode')
    cv.page()
    for l in U['lines']:
        cv.text(l['text'], l['x'], l['y'], U['size'], l['font'], l.get('rtl', False))
    cv.end()


def job_images(cv_open, ctx, out):
    I = SPEC['images']
    cv = cv_open(out, [], 'Images')
    for f in (I['png'], I['jpeg']):
        cv.page()
        img = cv.image(fx(f))
        w, h = img_size(fx(f))
        cv.draw(img, I['x'], I['y'], I['w'], I['w'] * h / w)
    cv.end()


CANVAS_JOBS = {'plain': job_plain, 'report': job_report, 'invoice': job_invoice, 'unicode': job_unicode, 'images': job_images,
               'pdfa': lambda o, c, out: job_invoice(o, c, out, True)}


# ---------------------------------------------------------------- ReportLab (canvas)
def reportlab():
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.colors import HexColor
    from reportlab.lib.utils import ImageReader
    H = P['h']

    class Cv:
        def __init__(self, out, keys, title, pdfa=False):
            for k in keys:
                if f'bench-{k}' not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(f'bench-{k}', font(k)))
            self.c, self.started = canvas.Canvas(out, pagesize=(P['w'], H)), False
            self.c.setTitle(title)

        def page(self):
            if self.started:
                self.c.showPage()
            self.started = True

        def text(self, s, x, y, size, k, rtl=False):
            self.c.setFont(f'bench-{k}', size)
            self.c.drawString(x, H - y - 0.8 * size, s)

        def width(self, s, size, k):
            return pdfmetrics.stringWidth(s, f'bench-{k}', size)

        def rect(self, x, y, w, h, col):
            self.c.setFillColor(HexColor(col))
            self.c.rect(x, H - y - h, w, h, stroke=0, fill=1)
            self.c.setFillColorRGB(0, 0, 0)

        def hline(self, x1, x2, y, w, col):
            self.c.setStrokeColor(HexColor(col))
            self.c.setLineWidth(w)
            self.c.line(x1, H - y, x2, H - y)

        def image(self, f):
            return ImageReader(f)

        def draw(self, img, x, y, w, h):
            self.c.drawImage(img, x, H - y - h, w, h, mask='auto')

        def end(self):
            self.c.save()
    return {'version': pkg_version('reportlab'), 'canvas': Cv}


# ---------------------------------------------------------------- PyMuPDF (create, read, edit)
def pymupdf_():
    import pymupdf

    class Cv:
        def __init__(self, out, keys, title, pdfa=False):
            self.out, self.doc, self.pg, self.tw = out, pymupdf.open(), None, None
            self.fonts = {k: pymupdf.Font(fontfile=font(k)) for k in keys}
            self.doc.set_metadata({'title': title})

        def flush(self):
            if self.tw:
                self.tw.write_text(self.pg)

        def page(self):
            self.flush()
            self.pg = self.doc.new_page(width=P['w'], height=P['h'])
            self.tw = pymupdf.TextWriter(self.pg.rect)

        def text(self, s, x, y, size, k, rtl=False):
            self.tw.append((x, y + 0.8 * size), s, font=self.fonts[k], fontsize=size, right_to_left=rtl)

        def width(self, s, size, k):
            return self.fonts[k].text_length(s, fontsize=size)

        def rect(self, x, y, w, h, col):
            self.pg.draw_rect(pymupdf.Rect(x, y, x + w, y + h), color=None, fill=rgb01(col), width=0)

        def hline(self, x1, x2, y, w, col):
            self.pg.draw_line((x1, y), (x2, y), color=rgb01(col), width=w)

        def image(self, f):
            return f

        def draw(self, img, x, y, w, h):
            self.pg.insert_image(pymupdf.Rect(x, y, x + w, y + h), filename=img)

        def end(self):
            self.flush()
            self.doc.save(self.out, deflate=True, garbage=1)

    def extract(f):
        with pymupdf.open(f) as d:
            return '\n'.join(p.get_text() for p in d)

    def merge(files, out):
        d = pymupdf.open()
        for f in files:
            with pymupdf.open(f) as s:
                d.insert_pdf(s)
        d.save(out, deflate=True, garbage=1)

    def split(file, outdir):
        s = pymupdf.open(file)
        for i in range(s.page_count):
            d = pymupdf.open()
            d.insert_pdf(s, from_page=i, to_page=i)
            d.save(os.path.join(outdir, f'p-{i + 1:04d}.pdf'), deflate=True, garbage=1)

    def encrypt(file, out, pw):
        pymupdf.open(file).save(out, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=pw['owner'], user_pw=pw['user'], deflate=True)

    def metadata(file, out, title):
        shutil.copyfile(file, out)  # PyMuPDF appends an update only to the file it opened
        d = pymupdf.open(out)
        d.set_metadata({**d.metadata, 'title': title})
        d.saveIncr()

    def form(file, out, v):
        d = pymupdf.open(file)
        for p in d:
            for w in p.widgets():
                if w.field_name == 'approved':
                    w.field_value = w.on_state() if v['approved'] else 'Off'
                else:
                    w.field_value = v[w.field_name]
                w.update()
        d.bake()
        d.save(out, deflate=True, garbage=1)
    return {'version': pkg_version('PyMuPDF'), 'canvas': Cv, 'extract': extract, 'merge': merge, 'split': split,
            'encrypt': encrypt, 'metadata': metadata, 'form': form}


# ---------------------------------------------------------------- pikepdf (qpdf's engine: structure edits)
def pikepdf_():
    import pikepdf

    def parse(f):
        with pikepdf.open(f) as d:
            for p in d.pages:
                p.mediabox
            d.save(io.BytesIO())

    def merge(files, out):
        d = pikepdf.new()
        srcs = [pikepdf.open(f) for f in files]
        for s in srcs:
            d.pages.extend(s.pages)
        d.save(out)

    def split(file, outdir):
        with pikepdf.open(file) as s:
            for i, p in enumerate(s.pages):
                d = pikepdf.new()
                d.pages.append(p)
                d.save(os.path.join(outdir, f'p-{i + 1:04d}.pdf'))

    def encrypt(file, out, pw):
        with pikepdf.open(file) as d:
            d.save(out, encryption=pikepdf.Encryption(owner=pw['owner'], user=pw['user'], R=6))
    return {'version': pkg_version('pikepdf'), 'parse': parse, 'merge': merge, 'split': split, 'encrypt': encrypt}


# ---------------------------------------------------------------- pypdf (pure Python)
def pypdf_():
    import pypdf

    def extract(f):
        return '\n'.join(p.extract_text() for p in pypdf.PdfReader(f).pages)

    def merge(files, out):
        w = pypdf.PdfWriter()
        for f in files:
            w.append(f)
        w.write(out)

    def split(file, outdir):
        for i, p in enumerate(pypdf.PdfReader(file).pages):
            w = pypdf.PdfWriter()
            w.add_page(p)
            w.write(os.path.join(outdir, f'p-{i + 1:04d}.pdf'))

    def encrypt(file, out, pw):
        w = pypdf.PdfWriter(clone_from=file)
        w.encrypt(user_password=pw['user'], owner_password=pw['owner'], algorithm='AES-256')
        w.write(out)

    def metadata(file, out, title):
        w = pypdf.PdfWriter(file, incremental=True)
        w.add_metadata({'/Title': title})
        w.write(out)

    def form(file, out, v):
        w = pypdf.PdfWriter(clone_from=file)
        w.update_page_form_field_values(w.pages[0], {'name': v['name'], 'amount': v['amount'], 'approved': '/Yes' if v['approved'] else '/Off'},
                                        auto_regenerate=False, flatten=True)
        w.remove_annotations(subtypes='/Widget')
        w.root_object.pop('/AcroForm', None)
        w.write(out)
    return {'version': pkg_version('pypdf'), 'extract': extract, 'merge': merge, 'split': split, 'encrypt': encrypt,
            'metadata': metadata, 'form': form}


def pdfminer_():
    from pdfminer.high_level import extract_text
    return {'version': pkg_version('pdfminer.six'), 'extract': lambda f: extract_text(f)}


def pdfplumber_():
    import pdfplumber

    def extract(f):
        with pdfplumber.open(f) as d:
            return '\n'.join(p.extract_text() or '' for p in d.pages)
    return {'version': pkg_version('pdfplumber'), 'extract': extract}


# ---------------------------------------------------------------- WeasyPrint (prints the shared HTML)
def weasyprint_():
    from weasyprint import HTML

    def printer(name, variant=None):
        def run(ctx, out):
            HTML(filename=fx(f"{SPEC['html']['dir']}/{name(ctx)}")).write_pdf(out, **({'pdf_variant': variant} if variant else {}))
        return run
    return {'version': pkg_version('weasyprint'), 'plain': printer(lambda c: f"plain-{c['pages']}.html"),
            'report': printer(lambda c: f"report-{len(c['rows'])}.html"), 'invoice': printer(lambda c: 'invoice.html'),
            'unicode': printer(lambda c: 'unicode.html'), 'images': printer(lambda c: 'images.html'),
            'pdfa': printer(lambda c: 'invoice.html', 'pdf/a-2b')}


# ---------------------------------------------------------------- PDFium (through pypdfium2)
def pdfium_():
    import pypdfium2 as pdfium

    def extract(f):
        d = pdfium.PdfDocument(f)
        return '\n'.join(d[i].get_textpage().get_text_range() for i in range(len(d)))

    def merge(files, out):
        d = pdfium.PdfDocument.new()
        for f in files:
            d.import_pages(pdfium.PdfDocument(f))
        d.save(out)

    def split(file, outdir):
        s = pdfium.PdfDocument(file)
        for i in range(len(s)):
            d = pdfium.PdfDocument.new()
            d.import_pages(s, [i])
            d.save(os.path.join(outdir, f'p-{i + 1:04d}.pdf'))
    return {'version': f"{pkg_version('pypdfium2')} (pdfium {pdfium.PDFIUM_INFO.build if hasattr(pdfium, 'PDFIUM_INFO') else '?'})",
            'extract': extract, 'merge': merge, 'split': split}


LIBS = {'reportlab': reportlab, 'PyMuPDF': pymupdf_, 'pikepdf': pikepdf_, 'pypdf': pypdf_, 'pdfminer.six': pdfminer_,
        'pdfplumber': pdfplumber_, 'weasyprint': weasyprint_, 'pdfium': pdfium_}


# ---------------------------------------------------------------- the frame
def inputs(job, size):
    e = SPEC['edit']
    if job == 'report':
        return {'rows': read_rows(size)}
    if job == 'plain':
        return {'pool': [l for l in Path(fx(SPEC['plain']['pool'])).read_text().split('\n') if l], 'pages': size}
    if job == 'read-big':
        return {'files': [fx(SPEC['read']['big'])]}
    if job == 'read-mixed':
        return {'files': sorted(str(p) for p in Path(fx(SPEC['read']['mixedDir'])).glob('*.pdf'))}
    if job == 'merge':
        return {'files': sorted(str(p) for p in Path(fx(e['mergeDir'])).glob('*.pdf'))[:size]}
    if job in ('split', 'encrypt', 'metadata'):
        return {'file': fx(e['doc'])}
    if job == 'form':
        return {'file': fx(e['form'])}
    if job == 'sign':
        return {'file': fx(e['signDoc'])}
    if job == 'parse':
        return {'file': os.environ['BENCH_INPUT']}
    return {}


def run_job(a, job, ctx, out):
    pdf = os.path.join(out, 'out.pdf')
    if job in CANVAS_JOBS or job == 'invoice-warm':
        j = 'invoice' if job == 'invoice-warm' else job
        if j in a:
            return a[j](ctx, pdf)
        return CANVAS_JOBS[j](a['canvas'], ctx, pdf)
    if job == 'read-big':
        Path(out, 'out.txt').write_text(a['extract'](ctx['files'][0]))
    elif job == 'read-mixed':
        for f in ctx['files']:
            Path(out, Path(f).stem + '.txt').write_text(a['extract'](f))
    elif job == 'parse':
        (a.get('parse') or a['extract'])(ctx['file'])
    elif job == 'merge':
        a['merge'](ctx['files'], pdf)
    elif job == 'split':
        a['split'](ctx['file'], out)
    elif job == 'encrypt':
        a['encrypt'](ctx['file'], pdf, SPEC['edit']['passwords'])
    elif job == 'metadata':
        a['metadata'](ctx['file'], pdf, SPEC['edit']['title'])
    elif job == 'form':
        a['form'](ctx['file'], pdf, SPEC['edit']['formValues'])
    else:
        raise ValueError(f'unknown job {job}')


def main():
    lib, job, size, out = sys.argv[1:5]
    try:
        a = LIBS[lib]()
        if job == 'version':
            print(json.dumps({'ok': True, 'version': a['version']}))
            return
        os.makedirs(out, exist_ok=True)
        ctx = inputs(job, int(size))
        reps, times, note = int(os.environ.get('REPS', '1')), [], None
        for _ in range(reps):
            t = time.perf_counter()
            note = run_job(a, job, ctx, out)
            times.append((time.perf_counter() - t) * 1000)
        r = {'ok': True, 'ms': times[0]}
        if reps > 1:
            r['warm_ms'] = statistics.median(times[-40:] if reps >= 50 else times[int(reps * 0.2):])
        if note:
            r['note'] = note
        print(json.dumps(r))
    except Exception as e:  # noqa: BLE001 - every library error is a result
        print(json.dumps({'ok': False, 'error': (repr(e) + ' ' + traceback.format_exc()[-400:])[:600]}))
    sys.stdout.flush()


if __name__ == '__main__':
    main()
