#!/usr/bin/env python3
"""Every input of the deep benchmark, made once and deterministically (seeded data, fixed dates). See ../README.md.

    python3 make.py <outdir> --rows 100,1000,10000 --fuzz 200 --repo <repo root>

Needs Pillow (images), qpdf and openssl on PATH. The PDFs are written by the small writer below (Helvetica, raw
objects), not by a contestant, so no library reads its own output. Expected texts and totals are written next to them.
"""
import argparse, hashlib, json, math, random, shutil, subprocess, urllib.request, zlib
from pathlib import Path

VOCAB_RNG = random.Random(7)
SYL = ['ka', 'lo', 'mi', 'tor', 'ven', 'sa', 'ri', 'qua', 'del', 'po', 'nex', 'ul', 'bra', 'shi', 'ten', 'gor']
VOCAB = sorted({''.join(VOCAB_RNG.choice(SYL) for _ in range(VOCAB_RNG.randint(1, 4))) for _ in range(900)})


def words_line(r, n=11):
    return ' '.join(r.choice(VOCAB) for _ in range(n))


# ---------------------------------------------------------------- a tiny PDF writer (Helvetica, WinAnsi, ASCII text)
def esc(s):
    return s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def content_for(lines, cols=1, tj=False):
    out, per = ['BT /F1 10 Tf 12 TL'], (len(lines) + cols - 1) // cols
    for c in range(cols):
        out.append(f'1 0 0 1 {50 + c * 260} 800 Tm')
        for ln in lines[c * per:(c + 1) * per]:
            if tj:  # kerned TJ arrays with hex strings, as many producers write
                parts = ln.split(' ')
                arr = ' '.join(f'<{p.encode().hex()}> -250' for p in parts)
                out.append(f'[{arr}] TJ T*')
            else:
                out.append(f'({esc(ln)}) Tj T*')
    out.append('ET')
    return '\n'.join(out).encode('latin-1')


def write_pdf(path, pages, compress=True, cols=1, tj=False, rotate=0, annots=None, acroform=None, extra=None, info=b'(Bench fixture)'):
    """pages: list of lists of text lines. annots/acroform/extra: raw object bodies (bytes), wired in by the caller."""
    objs = {}  # num -> bytes
    objs[1] = b'<< /Type /Catalog /Pages 2 0 R' + (b' /AcroForm ' + acroform if acroform else b'') + b' >>'
    objs[3] = b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    objs[4] = b'<< /Title ' + info + b' /Producer (bench fixture writer) /CreationDate (D:20260101000000Z) >>'
    kids, n = [], 10
    for i, lines in enumerate(pages):
        data = content_for(lines, cols, tj)
        if compress:
            data = zlib.compress(data, 6)
        objs[n + 1] = b'<< /Length %d%s >>\nstream\n' % (len(data), b' /Filter /FlateDecode' if compress else b'') + data + b'\nendstream'
        a = (b' /Annots ' + annots[i]) if annots and i < len(annots) else b''
        objs[n] = (b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /Helv 3 0 R >> >>'
                   b' /Contents %d 0 R%s%s >>' % (n + 1, b' /Rotate %d' % rotate if rotate else b'', a))
        kids.append(n)
        n += 2
    objs[2] = b'<< /Type /Pages /Kids [%s] /Count %d >>' % (b' '.join(b'%d 0 R' % k for k in kids), len(kids))
    for k, v in (extra or {}).items():
        objs[k] = v
    return emit(path, objs)


def emit(path, objs, trailer_extra=b'', xref_shift=0):
    buf = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
    size = max(objs) + 1
    off = {}
    for k in sorted(objs):
        off[k] = len(buf)
        buf += b'%d 0 obj\n' % k + objs[k] + b'\nendobj\n'
    xref = len(buf)
    buf += b'xref\n0 %d\n0000000000 65535 f \n' % size
    for k in range(1, size):
        buf += (b'%010d 00000 n \n' % (off[k] + xref_shift)) if k in off else b'0000000000 65535 f \n'
    buf += b'trailer\n<< /Size %d /Root 1 0 R /Info 4 0 R%s >>\nstartxref\n%d\n%%%%EOF\n' % (size, trailer_extra, xref)
    Path(path).write_bytes(bytes(buf))
    return bytes(buf)


def text_pages(seed, n_pages, lines=50):
    r = random.Random(seed)
    return [[words_line(r) for _ in range(lines)] for _ in range(n_pages)]


def save_text(path, pages):
    Path(path).write_text('\n'.join('\n'.join(p) for p in pages) + '\n')


def qpdf(*args):
    subprocess.run(['qpdf', *args], check=False)  # exit 3 = warnings, still written


# ---------------------------------------------------------------- the parts
def fonts(out, repo):
    d = out / 'fonts'
    d.mkdir(parents=True, exist_ok=True)
    for f in ['Inter-Regular.ttf', 'Inter-Bold.ttf', 'NotoSansDevanagari-Regular.ttf', 'NotoSansArabic-Regular.ttf']:
        shutil.copy(repo / 'public' / 'fonts' / f, d / f)
    # Noto Sans SC at the commit and hash @reportwright/fonts-cjk pins (packages/fonts-cjk/src/index.mjs)
    url = 'https://github.com/google/fonts/raw/5e8a3ba899557829a76cfdac30fa512bda91d7ca/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf'
    b = urllib.request.urlopen(url, timeout=120).read()
    assert hashlib.sha256(b).hexdigest() == 'a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da', 'NotoSansSC hash'
    (d / 'NotoSansSC.ttf').write_bytes(b)


def rows(out, n):
    """The ledger of bench/data.mjs (the same formula), as CSV, plus the expected totals."""
    regions, types = ['North', 'South', 'East', 'West'], ['Deposit', 'Withdrawal', 'Transfer', 'Fee', 'Interest']
    total, count = 0.0, 0
    with open(out / f'rows-{n}.csv', 'w') as f:
        f.write('id,account,region,type,date,amount,reference\n')
        for j in range(n):
            cents = ((j * 7919) % 200000 - 100000) * 1.37
            cents = math.floor(cents + 0.5)  # JS Math.round
            amt = cents / 100
            total += amt
            count += 1
            f.write(f'{j + 1},AC{10000 + (j * 7) % 9000},{regions[(j * 4) // n]},{types[j % 5]},2025-{j % 12 + 1:02d}-{1 + j % 28:02d},{amt:.2f},REF-{j * 31}\n')
    (out / f'rows-{n}.json').write_text(json.dumps({'count': count, 'sum': round(total, 2), 'sumText': f'{total:,.2f}'}))


def plain_pool(out):
    r = random.Random(11)
    (out / 'plain.txt').write_text('\n'.join(words_line(r, 13) for _ in range(600)) + '\n')


def images(out):
    from PIL import Image, ImageDraw
    d = out / 'img'
    d.mkdir(exist_ok=True)

    def photo(w, h, mode, seed):
        g = Image.linear_gradient('L').resize((w, h))
        chans = [g, g.rotate(90).resize((w, h)), Image.radial_gradient('L').resize((w, h))]
        noise = Image.frombytes('L', (w, h), random.Random(seed).randbytes(w * h))
        chans = [Image.blend(c, noise, 0.25) for c in chans]
        if mode == 'RGBA':
            chans.append(Image.linear_gradient('L').rotate(45).resize((w, h)).point(lambda v: 64 + v * 3 // 4))
        return Image.merge(mode, chans)
    photo(3000, 2000, 'RGBA', 1).save(d / 'rgba-6mp.png', optimize=False)
    photo(6000, 4000, 'RGB', 2).save(d / 'photo-24mp.jpg', quality=90)
    logo = Image.new('RGBA', (240, 72), (0, 0, 0, 0))
    dr = ImageDraw.Draw(logo)
    dr.rounded_rectangle((2, 2, 238, 70), 14, fill=(31, 78, 121, 200))
    dr.ellipse((14, 12, 62, 60), fill=(255, 255, 255, 255))
    dr.rectangle((80, 28, 220, 44), fill=(255, 255, 255, 160))
    logo.save(out / 'logo.png')


def read_set(out):
    d = out / 'read'
    m = d / 'mixed'
    m.mkdir(parents=True, exist_ok=True)
    big = text_pages(1200, 1200)
    write_pdf(d / 'big.pdf', big)
    save_text(d / 'big.txt', big)
    base = text_pages(42, 4)
    variants = {
        '01-uncompressed': dict(compress=False), '02-flate': {}, '06-rotated': dict(rotate=90),
        '07-two-column': dict(cols=2), '11-tj-hex-kerned': dict(tj=True),
    }
    for name, kw in variants.items():
        write_pdf(m / f'{name}.pdf', base, **kw)
    tmp = m / '_base.pdf'
    write_pdf(tmp, base)
    qpdf('--object-streams=generate', str(tmp), str(m / '03-object-streams.pdf'))
    qpdf('--linearize', str(tmp), str(m / '04-linearized.pdf'))
    qpdf('--encrypt', '', 'owner', '128', '--use-aes=y', '--', str(tmp), str(m / '05-aes128-empty-user.pdf'))
    qpdf('--qdf', str(tmp), str(m / '10-qdf.pdf'))
    b = tmp.read_bytes()  # 08: an incremental update appended (a new Info), as an editor saving in place writes it
    xref_at = int(b.rsplit(b'startxref\n', 1)[1].split(b'\n')[0])
    upd = b'4 0 obj\n<< /Title (Updated) >>\nendobj\n'
    new_xref = len(b) + len(upd)
    (m / '08-incremental.pdf').write_bytes(b + upd + b'xref\n0 1\n0000000000 65535 f \n4 1\n%010d 00000 n \ntrailer\n<< /Size 18 /Root 1 0 R /Info 4 0 R /Prev %d >>\nstartxref\n%d\n%%%%EOF\n' % (len(b), xref_at, new_xref))
    # 09: every xref offset wrong by 7 bytes: readers must repair
    write_pdf(m / '09-broken-xref.pdf', base)
    raw = (m / '09-broken-xref.pdf').read_bytes()
    (m / '09-broken-xref.pdf').write_bytes(raw.replace(b'%PDF-1.7\n', b'%PDF-1.7\n%junk!\n', 1))
    tmp.unlink()
    for f in sorted(m.glob('*.pdf')):
        save_text(f.with_suffix('.txt'), base)


def edit_set(out):
    d = out / 'edit' / 'merge'
    d.mkdir(parents=True, exist_ok=True)
    for i in range(100):
        write_pdf(d / f'm-{i:03d}.pdf', text_pages(1000 + i, 3, 20))
    write_pdf(out / 'edit' / 'doc-100.pdf', text_pages(5, 100, 30))
    # three pages and an empty signature field "sig1" on the first, for the sign job
    write_pdf(out / 'edit' / 'sign.pdf', text_pages(6, 3, 30), annots=[b'[20 0 R]'], acroform=b'<< /Fields [20 0 R] /SigFlags 0 >>',
              extra={20: b'<< /Type /Annot /Subtype /Widget /FT /Sig /T (sig1) /Rect [40 40 240 80] /F 4 /P 10 0 R >>'})
    # a form: two text fields and a checkbox, appearance streams for the checkbox, NeedAppearances for the text
    ap_on = b'<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 33 >>\nstream\n0 g 2 2 10 10 re f 0 0 14 14 re S\nendstream'
    ap_off = b'<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 14 >>\nstream\n0 0 14 14 re S\nendstream'
    w = lambda name, rect: b'<< /Type /Annot /Subtype /Widget /FT /Tx /T (%s) /V () /Rect [%s] /F 4 /P 10 0 R /DA (/Helv 10 Tf 0 g) /MK << /BC [0 0 0] >> >>' % (name, rect)
    extra = {20: w(b'name', b'150 700 400 722'), 21: w(b'amount', b'150 660 300 682'),
             22: b'<< /Type /Annot /Subtype /Widget /FT /Btn /T (approved) /V /Off /AS /Off /Rect [150 620 164 634] /F 4 /P 10 0 R /AP << /N << /Yes 23 0 R /Off 24 0 R >> >> /MK << /CA (4) >> >>',
             23: ap_on, 24: ap_off}
    write_pdf(out / 'edit' / 'form.pdf', [['Name', '', '', '', '', 'Amount', '', '', 'Approved']], annots=[b'[20 0 R 21 0 R 22 0 R]'],
              acroform=b'<< /Fields [20 0 R 21 0 R 22 0 R] /NeedAppearances true /DA (/Helv 0 Tf 0 g) /DR << /Font << /Helv 3 0 R >> >> >>', extra=extra)


def cert(out):
    d = out / 'cert'
    d.mkdir(exist_ok=True)
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', d / 'key.pem', '-out', d / 'cert.pem',
                    '-days', '3650', '-subj', '/CN=Deep Bench Test Signer/O=Bench'], check=True, capture_output=True)
    subprocess.run(['openssl', 'pkcs12', '-export', '-inkey', d / 'key.pem', '-in', d / 'cert.pem', '-out', d / 'cert.p12',
                    '-passout', 'pass:bench', '-name', 'bench'], check=True)


def fuzz(out, n):
    d = out / 'fuzz'
    d.mkdir(exist_ok=True)
    seeds = [p.read_bytes() for p in sorted((out / 'read' / 'mixed').glob('*.pdf'))] + [(out / 'edit' / 'form.pdf').read_bytes()]
    tokens = [b'0', b'-1', b'99999999999', b' R ', b'obj', b'endobj', b'<<', b'>>', b'[', b'(', b'/Length 0', b'stream', b'xref', b'\x00']
    for i in range(n):
        r = random.Random(10_000 + i)
        b = bytearray(seeds[i % len(seeds)])
        for _ in range(r.randint(1, 12)):
            op, p = r.randrange(5), r.randrange(len(b))
            if op == 0:
                b[p] = r.randrange(256)
            elif op == 1:
                b[p:p] = r.choice(tokens)
            elif op == 2:
                del b[p:p + r.randint(1, 64)]
            elif op == 3:
                q = r.randrange(len(b))
                b[p:p] = b[q:q + r.randint(1, 256)]
            else:
                del b[max(16, int(len(b) * r.uniform(0.5, 0.99))):]
        (d / f'f-{i:03d}.pdf').write_bytes(bytes(b))


def hostile(out):
    d = out / 'hostile'
    d.mkdir(exist_ok=True)
    page = lambda content_ref, extra=b'': b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents %s%s >>' % (content_ref, extra)
    pages = b'<< /Type /Pages /Kids [10 0 R] /Count 1 >>'
    base = {1: b'<< /Type /Catalog /Pages 2 0 R >>', 2: pages, 4: b'<< /Producer (hostile) >>'}
    # 1 GiB of zeros behind a ~1 MB Flate stream
    c, chunk, z = zlib.compressobj(9), bytes(1 << 20), bytearray()
    for _ in range(1024):
        z += c.compress(chunk)
    z += c.flush()
    emit(d / 'bomb.pdf', {**base, 10: page(b'11 0 R'), 11: b'<< /Length %d /Filter /FlateDecode >>\nstream\n' % len(z) + bytes(z) + b'\nendstream'})
    # a page tree that is its own grandparent
    emit(d / 'cycle.pdf', {**base, 2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 3: b'<< /Type /Pages /Parent 2 0 R /Kids [2 0 R 3 0 R] /Count 1 >>'})
    # 200,000 nested arrays in the page's resources
    emit(d / 'deep-nesting.pdf', {**base, 10: page(b'11 0 R', b' /Resources << /X ' + b'[' * 200_000 + b']' * 200_000 + b' >>'),
                                 11: b'<< /Length 0 >>\nstream\n\nendstream'})
    # a 64 MB string shown on the page
    s = b'BT /F1 9 Tf 50 800 Td (' + b'A' * (64 << 20) + b') Tj ET'
    emit(d / 'huge-string.pdf', {**base, 10: page(b'11 0 R'), 11: b'<< /Length %d >>\nstream\n' % len(s) + s + b'\nendstream'})
    # a cross-reference chain that points at itself
    p = d / 'xref-loop.pdf'
    emit(p, {**base, 10: page(b'11 0 R'), 11: b'<< /Length 0 >>\nstream\n\nendstream'})
    b = p.read_bytes()
    xref = int(b.rsplit(b'startxref\n', 1)[1].split(b'\n')[0])
    p.write_bytes(b.replace(b'/Info 4 0 R >>', b'/Info 4 0 R /Prev %d >>' % xref))
    # absurd sizes: two billion objects and pages claimed
    emit(d / 'huge-counts.pdf', {**base, 2: b'<< /Type /Pages /Kids [10 0 R] /Count 2000000000 >>', 10: page(b'11 0 R'),
                                 11: b'<< /Length 0 >>\nstream\n\nendstream'}, trailer_extra=b' /Size 2000000000')


# ---------------------------------------------------------------- the same HTML for the browser engines (Puppeteer, WeasyPrint)
def html_docs(out, sizes, spec):
    """One HTML file a create job (and a report size), built here once so both HTML engines print identical input."""
    d = out / 'html'
    d.mkdir(exist_ok=True)
    P, R, I = spec['page'], spec['report'], spec['invoice']
    from html import escape as e
    face = ''.join(f'@font-face{{font-family:{k};src:url(../{v})}}' for k, v in spec['fonts'].items())
    face += '@font-face{font-family:Inter;src:url(../fonts/Inter-Regular.ttf)}@font-face{font-family:Inter;font-weight:700;src:url(../fonts/Inter-Bold.ttf)}'
    base = face + f'*{{box-sizing:border-box}}body{{margin:0;font:9pt/1.1 Inter}}.a{{position:absolute;white-space:nowrap;line-height:1}}'

    def page_css(margins):
        return f'@page{{size:A4;margin:{margins}}}'

    def doc(css, body, title):
        return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title><style>{base}{css}</style></head><body>{body}</body></html>'

    # plain: one absolutely positioned page box a page, 60 lines each
    pool = [l for l in (out / 'plain.txt').read_text().split('\n') if l]
    pl = spec['plain']
    for n in [x for x in sizes['plain']]:
        pages = []
        for p in range(n):
            lines = ''.join(f'<div class="a" style="left:{pl["x"]}pt;top:{pl["y"] + k * pl["leading"]}pt">{e(pool[(p * pl["linesPerPage"] + k) % len(pool)])}</div>' for k in range(pl['linesPerPage']))
            pages.append(f'<section style="position:relative;width:{P["w"]}pt;height:{P["h"] - 1}pt;overflow:hidden;break-after:page">{lines}</section>')
        (d / f'plain-{n}.html').write_text(doc(page_css('0'), ''.join(pages), 'Plain'))
    # report: a table whose <thead> repeats, "Page N of M" from the @page margin box
    W = sum(c['w'] for c in R['cols'])
    css = (page_css(f'{P["margin"]}pt {P["margin"]}pt {P["margin"] + P["footer"]}pt {P["margin"]}pt')[:-1] +
           f';@bottom-right{{content:"Page " counter(page) " of " counter(pages);font:8pt Inter;vertical-align:top;padding-top:4pt}}}}'
           f'table{{width:{W}pt;border-collapse:collapse;table-layout:fixed}}th,td{{padding:0 2pt;white-space:nowrap;overflow:hidden;text-align:left;font-weight:400}}'
           f'thead th{{background:{R["headBg"]};height:{R["headH"]}pt;font-weight:700}}td{{height:{R["rowH"]}pt;border-bottom:.5pt solid {R["rule"]}}}'
           f'tr{{break-inside:avoid}}.r{{text-align:right}}.g td{{background:{R["groupBg"]};font-weight:700;height:{R["groupH"]}pt;border:0}}.t td{{font-weight:700;border:0}}')
    cols = '<colgroup>' + ''.join(f'<col style="width:{c["w"]}pt">' for c in R['cols']) + '</colgroup>'
    head = '<thead><tr>' + ''.join(f'<th{" class=r" if c["right"] else ""}>{c["label"]}</th>' for c in R['cols']) + '</tr></thead>'
    for n in [x for x in sizes['report'] if x <= 100000]:
        parts, groups = [], {}
        with open(out / f'rows-{n}.csv') as f:
            next(f)
            for line in f:
                c = line.rstrip('\n').split(',')
                groups.setdefault(c[2], []).append(c)
        tc, ts = 0, 0.0
        total = lambda label, cnt, sm: f'<tr class="t"><td colspan="2">{label}</td><td>{cnt}</td><td></td><td></td><td class="r">{sm:,.2f}</td><td></td></tr>'
        for g, rs in groups.items():
            parts.append(f'<tr class="g"><td colspan="7">Region {g}</td></tr>')
            sm = 0.0
            for c in rs:
                sm += float(c[5])
                parts.append(f'<tr><td>{c[0]}</td><td>{c[1]}</td><td>{c[2]}</td><td>{c[3]}</td><td>{c[4]}</td><td class="r">{float(c[5]):,.2f}</td><td>{c[6]}</td></tr>')
            parts.append(total('Region total', len(rs), sm))
            tc, ts = tc + len(rs), ts + sm
        parts.append(total('Grand total', tc, ts))
        (d / f'report-{n}.html').write_text(doc(css, f'<table>{cols}{head}<tbody>{"".join(parts)}</tbody></table>', 'Ledger'))
    # invoice: every text at its spec position; the table as absolutely positioned rows
    T = I['table']
    a = []
    for t in I['texts']:
        style = f'top:{t["y"]}pt;font-size:{t["size"]}pt;{"font-weight:700;" if t["bold"] else ""}'
        style += f'left:{t["x"]}pt;width:{t["w"]}pt;text-align:right' if t['right'] else f'left:{t["x"]}pt'
        a.append(f'<div class="a" style="{style}">{e(t["text"])}</div>')
    L = I['logo']
    a.append(f'<img class="a" src="../{L["file"]}" style="left:{L["x"]}pt;top:{L["y"]}pt;width:{L["w"]}pt;height:{L["h"]}pt">')
    TW = sum(c['w'] for c in T['cols'])

    def row(y, vals, bold, bg=None, rule=False):
        x, cells = T['x'], []
        if bg:
            cells.append(f'<div class="a" style="left:{x}pt;top:{y}pt;width:{TW}pt;height:{T["rowH"]}pt;background:{bg}"></div>')
        if rule:
            cells.append(f'<div class="a" style="left:{x}pt;top:{y + T["rowH"] - 0.25}pt;width:{TW}pt;border-top:.5pt solid {R["rule"]}"></div>')
        for c, v in zip(T['cols'], vals):
            if v:
                al = f'left:{x + 2}pt;width:{c["w"] - 4}pt;text-align:right' if c['right'] else f'left:{x + 2}pt'
                cells.append(f'<div class="a" style="{al};top:{y + 5}pt;font-size:{T["size"]}pt{";font-weight:700" if bold else ""}">{e(v)}</div>')
            x += c['w']
        return ''.join(cells)
    y = T['y']
    a.append(row(y, [c['label'] for c in T['cols']], True, R['headBg']))
    y += T['rowH']
    for r in T['rows']:
        a.append(row(y, r, False, rule=True))
        y += T['rowH']
    for i, (l, v) in enumerate(T['totals']):
        a.append(row(y, ['', '', l, v], i == 2))
        y += T['rowH']
    (d / 'invoice.html').write_text(doc(page_css('0'), ''.join(a), 'Invoice'))
    U = spec['unicode']
    u = ''.join(f'<div class="a" dir="{"rtl" if l.get("rtl") else "ltr"}" style="left:{l["x"]}pt;top:{l["y"]}pt;font:{U["size"]}pt {l["font"]}">{e(l["text"])}</div>' for l in U['lines'])
    (d / 'unicode.html').write_text(doc(page_css('0'), u, 'Unicode'))
    im = spec['images']
    imgs = ''.join(f'<section style="height:{P["h"] - 1}pt;break-after:page;padding:{im["y"]}pt 0 0 {im["x"]}pt"><img src="../{f}" style="width:{im["w"]}pt"></section>' for f in (im['png'], im['jpeg']))
    (d / 'images.html').write_text(doc(page_css('0'), imgs, 'Images'))


def main():
    a = argparse.ArgumentParser()
    a.add_argument('out')
    a.add_argument('--rows', default='100,1000,10000')
    a.add_argument('--plain', default='10,100')
    a.add_argument('--fuzz', type=int, default=200)
    a.add_argument('--repo', default=str(Path(__file__).resolve().parents[3]))
    o = a.parse_args()
    out = Path(o.out)
    out.mkdir(parents=True, exist_ok=True)
    fonts(out, Path(o.repo))
    shutil.copy(Path(__file__).parent.parent / 'spec.json', out / 'spec.json')
    sizes = {'report': [int(x) for x in o.rows.split(',') if x], 'plain': [int(x) for x in o.plain.split(',') if x]}
    for n in sizes['report']:
        rows(out, n)
    plain_pool(out)
    html_docs(out, sizes, json.loads((out / 'spec.json').read_text()))
    images(out)
    read_set(out)
    edit_set(out)
    cert(out)
    fuzz(out, o.fuzz)
    hostile(out)
    print(f'fixtures in {out}')


if __name__ == '__main__':
    main()
