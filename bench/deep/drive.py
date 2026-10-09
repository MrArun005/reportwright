#!/usr/bin/env python3
"""Runs one language's contestants over the tier's jobs and writes one JSON line per cell. See README.md.

    python3 drive.py --lang js --tier quick --runs 5 --fixtures /tmp/fx --out results/js.jsonl

Every run is a fresh process started here: wall time, CPU (user+sys) and peak RSS come from wait4()'s rusage (the
numbers /usr/bin/time -v prints), and the process group's summed RSS is also sampled every 100 ms (for browsers and
other multi-process contestants) and used to enforce the memory cap. The first run of a cell is a warm-up and is
dropped. The last run's output is then validated (qpdf, MuPDF, pdf.js, and the job's own correctness check).
Standard library only.
"""
import argparse, json, os, platform, re, signal, statistics, subprocess, sys, time, unicodedata
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
JOBS = ['plain', 'report', 'invoice', 'invoice-warm', 'unicode', 'images', 'pdfa', 'read-big', 'read-mixed',
        'merge', 'split', 'encrypt', 'metadata', 'form', 'sign', 'fuzz', 'hostile']
CREATE = {'plain', 'report', 'invoice', 'invoice-warm', 'unicode', 'images', 'pdfa'}
ROBUST = {'fuzz', 'hostile'}
PLAN = {
    'quick': {'plain': [10, 100], 'report': [100, 1000, 10000], 'fuzz': [25]},
    'full': {'plain': [10, 100, 1000], 'report': [100, 1000, 10000, 100000], 'fuzz': [200]},
    'million': {'report': [1000000]},
}
DEFAULT_SIZES = {'invoice': [1], 'invoice-warm': [50], 'unicode': [1], 'images': [1], 'pdfa': [1], 'read-big': [1200],
                 'read-mixed': [11], 'merge': [100], 'split': [100], 'encrypt': [1], 'metadata': [1], 'form': [1],
                 'sign': [1], 'hostile': [6]}
CELL_TIMEOUT = {'quick': 300, 'full': 900, 'million': 1800}
HANG_S = 30  # robustness: a file that takes longer is a hang
PAGE_SIZE = os.sysconf('SC_PAGE_SIZE')


def sh(*cmd, timeout=600, **kw):
    try:
        return subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=timeout, errors='replace', **kw)
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return subprocess.CompletedProcess(cmd, 99, '', str(e))


def group_rss(pgid):
    """Summed RSS (bytes) of every process in the group."""
    total = 0
    for d in (os.listdir('/proc') if os.path.isdir('/proc') else []):
        if not d.isdigit():
            continue
        try:
            st = open(f'/proc/{d}/stat').read()
            f = st[st.rindex(')') + 2:].split()
            if int(f[2]) == pgid:  # field 5 (pgrp), counted after the comm field
                total += int(f[21]) * PAGE_SIZE  # field 24 (rss, pages)
        except (OSError, ValueError, IndexError):
            pass
    return total


def run_once(cmd, env, timeout, cap_mb, watch=None):
    """One process. Returns a dict with status ok|error|crash|timeout|oom and the measurements."""
    t0 = time.perf_counter()
    with open(env['BENCH_LOG'], 'w') as log:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True)
    os.set_blocking(p.stdout.fileno(), False)
    out, peak, ttfb, killed = b'', 0, None, None
    while True:
        pid, status, ru = os.wait4(p.pid, os.WNOHANG)
        try:
            out += p.stdout.read() or b''
        except (BlockingIOError, TypeError):
            pass
        if pid:
            break
        el = time.perf_counter() - t0
        rss = group_rss(p.pid)
        peak = max(peak, rss)
        if watch and ttfb is None:
            try:
                if os.path.getsize(watch) > 0:
                    ttfb = el * 1000
            except OSError:
                pass
        if killed is None and (el > timeout or rss > cap_mb * 2**20):
            killed = 'timeout' if el > timeout else 'oom'
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        time.sleep(0.1 if el > 1 else 0.02)
    try:
        os.killpg(p.pid, signal.SIGKILL)  # leftovers (a browser) must not outlive the run
    except ProcessLookupError:
        pass
    try:
        out += p.stdout.read() or b''
    except BlockingIOError:
        pass
    p.returncode = status  # reaped above by wait4
    wall = (time.perf_counter() - t0) * 1000
    r = {'wall_ms': wall, 'cpu_ms': (ru.ru_utime + ru.ru_stime) * 1000, 'rss_mb': max(ru.ru_maxrss / 1024, peak / 2**20), 'ttfb_ms': ttfb}
    line = next((l for l in reversed(out.decode('utf-8', 'replace').splitlines()) if l.startswith('{')), None)
    try:
        r['h'] = json.loads(line) if line else {}
    except ValueError:
        r['h'] = {}
    tail = Path(env['BENCH_LOG']).read_text(errors='replace')[-4000:]
    if killed:
        r['status'] = killed
    elif os.WIFSIGNALED(status):
        r['status'] = 'oom' if os.WTERMSIG(status) == signal.SIGKILL else 'crash'  # SIGKILL from outside: the kernel's OOM killer
    elif os.WEXITSTATUS(status) == 0 and r['h'].get('ok'):
        r['status'] = 'ok'
    elif re.search(r'OutOfMemory|out of memory|MemoryError|heap limit|std::bad_alloc|memory allocation of', tail, re.I):
        r['status'] = 'oom'
    elif r['h'] and r['h'].get('ok') is False:
        r['status'] = 'error'  # the library refused the input with an error the harness caught
    else:
        r['status'] = 'crash'  # no result line: an uncaught exception, a panic, an abort
    if r['status'] != 'ok':
        r['error'] = (r['h'].get('error') or tail[-600:]).strip()[:600]
    return r


def stats(xs):
    xs = [x for x in xs if x is not None]
    return {'median': round(statistics.median(xs), 2), 'min': round(min(xs), 2), 'max': round(max(xs), 2)} if xs else None


# ---------------------------------------------------------------- checks on the output
def norm(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', s))


def text_of(pdf, first=None, last=None):
    rng = (['-f', first, '-l', last] if first else [])
    a = sh('pdftotext', '-enc', 'UTF-8', *rng, pdf, '-').stdout
    b = sh('mutool', 'draw', '-q', '-F', 'txt', '-o', '-', pdf, *([f'{first}-{last}'] if first else [])).stdout
    return a, b


def npages(pdf):
    r = sh('qpdf', '--show-npages', pdf)
    return int(r.stdout.strip()) if r.stdout.strip().isdigit() else None


def validate(pdf):
    """qpdf --check, MuPDF opening and drawing the first and last page, pdf.js loading them."""
    v = {}
    q = sh('qpdf', '--check', pdf, timeout=900)
    v['qpdf'] = q.returncode in (0, 3)
    n = npages(pdf) or 1
    m = sh('mutool', 'draw', '-q', '-F', 'txt', '-o', '/dev/null', pdf, f'1,{n}', timeout=900)
    v['mupdf'] = m.returncode == 0 and 'error' not in m.stderr.lower()
    j = sh('node', HERE / 'tools' / 'pdfjs-check.mjs', pdf, timeout=900)
    try:
        v['pdfjs'] = json.loads(j.stdout.strip().splitlines()[-1]).get('ok', False)
    except (ValueError, IndexError):
        v['pdfjs'] = False
    v['ok'] = v['qpdf'] and v['mupdf'] and v['pdfjs']
    if not v['ok']:
        v['detail'] = (q.stdout[-300:] + m.stderr[-300:] + j.stdout[-300:] + j.stderr[-300:]).strip()
    return v, npages(pdf)


def recall(expected, got):
    """The share of the expected words found (a multiset), so reading order and spacing do not matter."""
    e, g = Counter(expected.split()), Counter(got.split())
    return round(sum(min(c, g[w]) for w, c in e.items()) / max(1, sum(e.values())), 4)


def verapdf(pdf):
    r = sh('verapdf', '--flavour', '2b', '--format', 'text', pdf, timeout=600)
    if r.returncode == 99:
        return None
    return 'PASS' in r.stdout


def check(job, size, out, fx, spec, h):
    """The job's own correctness check. Returns (fields to merge into the record, pass?)."""
    pdf = out / 'out.pdf'
    if job in CREATE or job in ('merge', 'encrypt', 'metadata', 'form', 'sign'):
        if not pdf.exists():
            return {'text': {'ok': False, 'why': 'no out.pdf'}}, False
        v, n = validate(pdf)
        rec = {'valid': v, 'pages': n, 'bytes': pdf.stat().st_size}
        t = {}
        if job == 'plain':
            t['ok'] = n == size
        elif job == 'report':
            tot = json.loads((fx / f'rows-{size}.json').read_text())
            a, b = text_of(pdf, n, n) if n else ('', '')
            last = a + b
            nums = [float(x.replace(',', '')) for x in re.findall(r'-?[\d,]+\.\d\d', last)]
            t = {'pageNofM': f'Page {n} of {n}' in re.sub(r'\s+', ' ', last), 'grandTotal': 'Grand total' in last,
                 'sum': any(abs(x - tot['sum']) < 0.011 for x in nums)}
            t['ok'] = all(t.values())
        elif job in ('invoice', 'invoice-warm', 'pdfa'):
            a, b = text_of(pdf)
            t['ok'] = all(norm(s) in norm(a) or norm(s) in norm(b) for s in ['INVOICE', '37,661.40', 'Contoso Retail plc'])
            if job == 'pdfa':
                rec['pdfa'] = verapdf(pdf)
        elif job == 'unicode':
            a, b = text_of(pdf)
            for ln in spec['unicode']['lines']:
                t[ln['script']] = norm(ln['text']) in norm(a) or norm(ln['text']) in norm(b)
            t['ok'] = all(t.values())
        elif job == 'images':
            imgs = sh('pdfimages', '-list', pdf).stdout.splitlines()[2:]
            t = {'images': len(imgs), 'ok': n == 2 and len(imgs) >= 2}
        elif job == 'merge':
            t['ok'] = n == spec['edit']['mergeCount'] * spec['edit']['mergePagesEach']
        elif job == 'encrypt':
            e = sh('qpdf', '--show-encryption', pdf).stdout
            t = {'aes256': 'AESv3' in e or 'R = 6' in e, 'ok': ('AESv3' in e or 'R = 6' in e) and n == spec['edit']['docPages']}
        elif job == 'metadata':
            src = (fx / spec['edit']['doc']).read_bytes()
            title = re.search(r'^Title:\s*(.*)$', sh('pdfinfo', pdf).stdout, re.M)
            t = {'title': bool(title and title.group(1).strip() == spec['edit']['title']),
                 'incremental': pdf.read_bytes()[:len(src)] == src}
            t['ok'] = t['title'] and t['incremental']
        elif job == 'form':
            a, b = text_of(pdf)
            j = sh('qpdf', '--json', '--json-key=acroform', pdf).stdout
            try:
                fields = len(json.loads(j)['acroform']['fields'])
            except (ValueError, KeyError):
                fields = None
            t = {'filled': 'AanyaSharma' in norm(a + b), 'flattened': fields == 0}
            t['ok'] = t['filled'] and t['flattened']
        elif job == 'sign':
            s = sh('pdfsig', pdf).stdout
            t = {'ok': 'Signature is Valid' in s, 'pdfsig': s.strip()[-300:]}
        rec['text'] = t
        return rec, v['ok'] and t.get('ok', True)
    if job == 'split':
        files = sorted(out.glob('*.pdf'))
        ok = len(files) == spec['edit']['docPages'] and all(npages(f) == 1 for f in (files[:1] + files[-1:]))
        v = validate(files[0])[0] if files else {'ok': False}
        return {'valid': v, 'text': {'files': len(files), 'ok': ok}, 'bytes': sum(f.stat().st_size for f in files)}, ok and v['ok']
    if job == 'read-big':
        got = (out / 'out.txt').read_text(errors='replace') if (out / 'out.txt').exists() else ''
        r = recall((fx / spec['read']['bigText']).read_text(), got)
        return {'text': {'recall': r, 'ok': r >= 0.99}}, r >= 0.99
    if job == 'read-mixed':
        per = {}
        for e in sorted((fx / spec['read']['mixedDir']).glob('*.txt')):
            g = out / e.name
            per[e.stem] = recall(e.read_text(), g.read_text(errors='replace') if g.exists() else '')
        mean = round(sum(per.values()) / max(1, len(per)), 4)
        return {'text': {'recall': mean, 'files': per, 'ok': mean >= 0.99}}, mean >= 0.99
    return {}, True


# ---------------------------------------------------------------- cells
def env_for(fx, out, extra=None):
    e = dict(os.environ, BENCH_FIXTURES=str(fx), BENCH_SPEC=str(fx / 'spec.json'), BENCH_LOG=str(out.parent / f'{out.name}.log'))
    e.update(extra or {})
    return e


def clean(d):
    if d.exists():
        subprocess.run(['rm', '-rf', str(d)])
    d.mkdir(parents=True)


def cell(lib, c, job, size, a, fx, spec, work):
    out = work / f'{lib}-{job}-{size}'
    base = {'type': 'cell', 'lang': a.lang, 'lib': lib, 'version': c.get('_version'), 'job': job, 'size': size}
    if job in ROBUST:
        files = sorted((fx / spec['robust']['fuzzDir' if job == 'fuzz' else 'hostileDir']).glob('*.pdf'))[:size]
        tally, cases = Counter(), {}
        for f in files:
            clean(out)
            r = run_once(c['cmd'] + ['parse', '1', str(out)], env_for(fx, out, {'BENCH_INPUT': str(f)}), HANG_S, a.cap_mb)
            st = {'timeout': 'hang', 'error': 'clean-error'}.get(r['status'], r['status'])
            tally[st] += 1
            if job == 'hostile' or st in ('crash', 'hang', 'oom'):
                cases[f.name] = st
        return {**base, 'status': 'ok', 'robust': dict(tally), 'cases': cases, 'files': len(files)}
    heavy = (job == 'report' and size >= 10000) or job == 'read-big'
    # quick is indicative: its heavy cells run once, without a warm-up; full keeps the warm-up and at most 3 runs there
    runs = 1 if a.tier == 'million' or (heavy and a.tier == 'quick') else min(a.runs, 3) if heavy or a.tier == 'quick' else a.runs
    warmup = 0 if a.tier == 'million' or (heavy and a.tier == 'quick') else 1
    extra = {'REPS': '50'} if job == 'invoice-warm' else {}
    res = []
    for i in range(warmup + runs):
        clean(out)
        r = run_once(c['cmd'] + [job, str(size), str(out)], env_for(fx, out, extra), CELL_TIMEOUT[a.tier], a.cap_mb,
                     watch=out / 'out.pdf' if job in CREATE else None)
        if r['status'] != 'ok':
            return {**base, 'status': r['status'], 'error': r.get('error'), 'wall_ms': round(r['wall_ms']), 'rss_mb': round(r['rss_mb'], 1)}
        if i >= warmup:
            res.append(r)
    rec = {**base, 'status': 'ok', 'runs': runs,
           'cold_ms': stats([r['wall_ms'] for r in res]),
           'warm_ms': stats([r['h'].get('warm_ms', r['h'].get('ms')) for r in res]),
           'cpu_ms': stats([r['cpu_ms'] for r in res]),
           'rss_mb': stats([r['rss_mb'] for r in res]),
           'ttfb_ms': stats([r['ttfb_ms'] for r in res]) if job in CREATE else None,
           'note': res[-1]['h'].get('note')}
    more, ok = check(job, size, out, fx, spec, res[-1]['h'])
    rec.update(more)
    if not ok:
        rec['status'] = 'invalid'
    subprocess.run(['rm', '-rf', str(out)])
    return rec


def meta(a, langs):
    cpu = re.search(r'model name\s*:\s*(.*)', Path('/proc/cpuinfo').read_text())
    mem = re.search(r'MemTotal:\s*(\d+)', Path('/proc/meminfo').read_text())
    first = lambda r: (r.stdout + r.stderr).strip().splitlines()[0:1]
    tools = {t: first(sh(*cmd)) for t, cmd in {
        'qpdf': ['qpdf', '--version'], 'mutool': ['mutool', '-v'], 'pdftotext': ['pdftotext', '-v'],
        'verapdf': ['verapdf', '--version']}.items()}
    rt = langs[a.lang].get('runtime')
    if rt:
        r = sh(*rt)
        tools['runtime'] = (r.stdout + r.stderr).strip().splitlines()[0:2]
    return {'type': 'meta', 'lang': a.lang, 'tier': a.tier, 'runs': a.runs, 'date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'cpu': cpu.group(1).strip() if cpu else platform.processor(), 'cores': os.cpu_count(),
            'ram_mb': int(mem.group(1)) // 1024 if mem else None, 'os': platform.platform(), 'cap_mb': a.cap_mb,
            'runner': os.environ.get('RUNNER_NAME'), 'tools': tools}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--lang', required=True)
    p.add_argument('--tier', default='quick', choices=list(PLAN))
    p.add_argument('--runs', type=int, default=5)
    p.add_argument('--fixtures', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--work', default='/tmp/deep-work')
    p.add_argument('--cap-mb', type=int, default=int(os.environ.get('MEM_CAP_MB', '6000')))
    p.add_argument('--only', default='', help='comma list of jobs, for a partial rerun')
    a = p.parse_args()
    fx, work = Path(a.fixtures).resolve(), Path(a.work)
    spec = json.loads((fx / 'spec.json').read_text())
    langs = json.loads((HERE / 'contestants.json').read_text())['langs']
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    plan = {**({} if a.tier == 'million' else DEFAULT_SIZES), **PLAN[a.tier]}
    with open(a.out, 'w') as o:
        def emit(rec):
            o.write(json.dumps(rec, ensure_ascii=False) + '\n')
            o.flush()
            print(json.dumps({k: rec.get(k) for k in ('lib', 'job', 'size', 'status', 'cold_ms', 'robust')}), flush=True)
        emit(meta(a, langs))
        for lib, c in langs[a.lang]['libs'].items():
            if a.tier == 'million' and not c.get('million'):
                continue
            v = run_once(c['cmd'] + ['version', '0', str(work)], env_for(fx, work / 'v'), 300, a.cap_mb)
            c['_version'] = v['h'].get('version') if v['status'] == 'ok' else None
            if v['status'] != 'ok':
                emit({'type': 'cell', 'lang': a.lang, 'lib': lib, 'job': 'version', 'size': 0, 'status': v['status'], 'error': v.get('error')})
                continue
            for job in JOBS:
                cap = 'parse' if job in ROBUST else job
                if cap not in c['jobs'] or job not in plan or (a.only and job not in a.only.split(',')):
                    continue
                for size in plan[job]:
                    try:
                        emit(cell(lib, c, job, size, a, fx, spec, work))
                    except Exception as e:  # a bug here must not lose the other cells
                        emit({'type': 'cell', 'lang': a.lang, 'lib': lib, 'version': c['_version'], 'job': job, 'size': size, 'status': 'harness-error', 'error': repr(e)[:600]})


if __name__ == '__main__':
    main()
