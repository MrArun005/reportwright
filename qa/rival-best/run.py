"""qa-rival-best driver: python3 qa/rival-best/run.py <rival> <outdir>

qa/rival-best/<rival>/case.json:
  rival, case, gap (null, or "<what>": we cannot express the case -> SKIP "feature gap: <what>"),
  partial (optional: what our reproduction leaves out), kind ("pdf", or "text" when the outputs are extracted text),
  build (untimed setup), prep (untimed inputs), theirs / ours (timed; write $OUT/theirs.<pdf|txt> / $OUT/ours.<...>).
Commands run in the case folder with OUT set. Each side: 1 warm-up + 3 measured runs, median wall ms, peak RSS (GNU time).
Result: ours invalid or failing = FAIL; gap = SKIP; rival failing = SKIP (reason); else ours/theirs time
<= 1 PASS (we beat them at their own best), <= 3 WARN, beyond FAIL. Fidelity (text equality, % pixels differing at
150 dpi) is measured and reported, not graded: it shows how close the reproduction is.
"""
import json, os, pathlib, statistics, subprocess, sys, time, difflib
sys.path.insert(0, str(pathlib.Path(__file__).parent / 'lib'))
from qa import emit

RUNS = int(os.environ.get('RUNS', '3'))


def sh(cmd, cwd, env, timeout=900):
    return subprocess.run(['bash', '-c', cmd], cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)


def measure(cmd, cwd, env):
    ms, mb, err = [], [], None
    for i in range(RUNS + 1):
        t = time.perf_counter()
        try:
            p = sh(f'/usr/bin/time -f %M -o "$OUT/.rss" {cmd}', cwd, env)
        except subprocess.TimeoutExpired:
            return None, None, 'timeout'
        el = (time.perf_counter() - t) * 1000
        if p.returncode:
            return None, None, (p.stderr or p.stdout)[-400:]
        if i:
            ms.append(el)
            mb.append(int(open(env['OUT'] + '/.rss').read().split()[-1]) / 1024)
    return statistics.median(ms), max(mb), err


def text_of(f):
    p = subprocess.run(['pdftotext', '-enc', 'UTF-8', str(f), '-'], capture_output=True, text=True)
    return ' '.join(p.stdout.split())


def pages(f):
    p = subprocess.run(['pdfinfo', str(f)], capture_output=True, text=True)
    return next((int(l.split()[-1]) for l in p.stdout.splitlines() if l.startswith('Pages:')), 0)


def visual_diff(a, b, tmp):
    """% of pixels that differ (gray > 48) at 150 dpi over the first 20 pages; a page only one side has counts 100%."""
    from PIL import Image, ImageChops
    for f, s in ((a, 'a'), (b, 'b')):
        subprocess.run(['pdftoppm', '-r', '150', '-l', '20', '-gray', '-png', str(f), f'{tmp}/{s}'], check=True)
    pa, pb = sorted(pathlib.Path(tmp).glob('a*.png')), sorted(pathlib.Path(tmp).glob('b*.png'))
    tot = []
    for x, y in zip(pa, pb):
        ia, ib = Image.open(x).convert('L'), Image.open(y).convert('L').resize(Image.open(x).size)
        d = ImageChops.difference(ia, ib).point(lambda v: 255 if v > 48 else 0)
        tot.append(100 * d.histogram()[255] / (ia.size[0] * ia.size[1]))
    tot += [100.0] * abs(len(pa) - len(pb))
    for f in pa + pb:
        f.unlink()
    return (sum(tot) / len(tot) if tot else 100.0), pages(a), pages(b)


def valid(f):
    p = subprocess.run(['qpdf', '--check', str(f)], capture_output=True, text=True)
    return p.returncode in (0, 3), (p.stdout + p.stderr).strip().splitlines()[-1:] or ['']


def main():
    rival, outdir = sys.argv[1], sys.argv[2]
    d = pathlib.Path(__file__).parent / rival
    c = json.load(open(d / 'case.json'))
    out = pathlib.Path(os.environ.get('RUNNER_TEMP', '/tmp')) / f'rb-{rival}'
    out.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'OUT': str(out)}
    check = f"{c['rival']} showcase: {c['case']}"
    rows = []
    for step in ('build', 'prep'):
        if c.get(step):
            p = sh(c[step], d, env, 1800)
            if p.returncode:
                print(p.stdout[-3000:], p.stderr[-3000:])
                rows.append({'check': check, 'command': c[step], 'expected': f'{step} succeeds', 'actual': f'{step} failed: {(p.stderr or p.stdout)[-300:]}', 'result': 'FAIL' if step == 'build' and not c.get('theirs') else 'SKIP'})
                return emit(rows, 'rival-best', outdir)
    ext = 'txt' if c.get('kind') == 'text' else 'pdf'
    t_ms, t_mb, t_err = measure(c['theirs'], d, env)
    theirs = out / f'theirs.{ext}'
    tdesc = f"theirs {t_ms:.0f} ms {t_mb:.0f} MB {theirs.stat().st_size // 1024} KB" if t_ms else f'theirs failed: {t_err}'
    if c.get('gap'):
        rows.append({'check': check, 'command': c['theirs'], 'expected': 'ReportWright reproduces the case', 'actual': f"feature gap: {c['gap']}; {tdesc}", 'result': 'SKIP'})
        return emit(rows, 'rival-best', outdir)
    o_ms, o_mb, o_err = measure(c['ours'], d, env)
    ours = out / f'ours.{ext}'
    base = {'check': check, 'command': c['ours'], 'expected': 'valid output, faster than the rival on its own showcase'}
    if o_ms is None:
        rows.append({**base, 'actual': f'ours failed: {o_err}', 'result': 'FAIL'})
        return emit(rows, 'rival-best', outdir)
    odesc = f"ours {o_ms:.0f} ms {o_mb:.0f} MB {ours.stat().st_size // 1024} KB"
    if ext == 'pdf':
        ok, why = valid(ours)
        if not ok:
            rows.append({**base, 'actual': f'ours invalid (qpdf): {why[0]}; {odesc}', 'result': 'FAIL', 'ms': o_ms, 'mb': o_mb})
            return emit(rows, 'rival-best', outdir)
    if t_ms is None:
        rows.append({**base, 'actual': f'{odesc}; rival did not run: {t_err}', 'result': 'SKIP', 'ms': o_ms, 'mb': o_mb})
        return emit(rows, 'rival-best', outdir)
    if ext == 'pdf':
        ta, tb = text_of(theirs), text_of(ours)
        pix, pt, po = visual_diff(theirs, ours, out)
        fid = f"text {'equal' if ta == tb else f'{100 * difflib.SequenceMatcher(None, ta.split(), tb.split(), autojunk=False).ratio():.0f}% similar'}, pixels {pix:.1f}% differ, pages {pt} vs {po}"
    else:
        ta, tb = theirs.read_text(errors='replace').split(), ours.read_text(errors='replace').split()
        fid = f"extracted words {'equal' if ta == tb else f'{100 * difflib.SequenceMatcher(None, ta, tb, autojunk=False).ratio():.0f}% similar'} ({len(tb)} vs {len(ta)})"
    ratio = o_ms / t_ms
    res = 'PASS' if ratio <= 1 else 'WARN' if ratio <= 3 else 'FAIL'
    part = f"; partial: {c['partial']}" if c.get('partial') else ''
    rows.append({**base, 'actual': f'{odesc} vs {tdesc} = {ratio:.2f}x; {fid}{part}', 'result': res, 'ms': o_ms, 'mb': o_mb})
    emit(rows, 'rival-best', outdir)


if __name__ == '__main__':
    main()
