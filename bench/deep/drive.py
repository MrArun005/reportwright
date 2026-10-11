#!/usr/bin/env python3
"""Runs one language's contestants over the tier's jobs and writes one JSON line per cell. See README.md.

    python3 drive.py --lang js --tier quick --runs 5 --fixtures /tmp/fx --out results/js.jsonl

Every run is a fresh process started here: wall time, CPU (user+sys) and peak RSS come from wait4()'s rusage (the
numbers /usr/bin/time -v prints), and the process group's summed RSS is also sampled every 100 ms (for browsers and
other multi-process contestants) and used to enforce the memory cap. The first run of a cell is a warm-up and is
dropped. The last run's output is then validated (qpdf, MuPDF, pdf.js, and the job's own correctness check).
On Windows (the SSRS job) the same numbers come from the process handle: GetProcessTimes and the peak working set.
Standard library only.
"""
import argparse, json, os, platform, re, shutil, signal, statistics, subprocess, sys, threading, time, unicodedata
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
JOBS = ['plain', 'report', 'invoice', 'invoice-warm', 'unicode', 'images', 'pdfa', 'read-big', 'read-mixed',
        'merge', 'split', 'encrypt', 'metadata', 'form', 'sign', 'fuzz', 'hostile', 'bulk']
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
# bulk: one process renders BULK_N separate files of one engine-league job ("kind" = the cell's size), group 'bulk' only
BULK_KINDS = {'plain': 10, 'report': 100, 'invoice': 1, 'unicode': 1, 'pdfa': 1}  # kind -> the job's size
BULK_N = 1000
BULK_LIBS = {'@reportwright/engine', 'jasperreports', 'QuestPDF', 'pdfmake'}
CELL_TIMEOUT = {'quick': 300, 'full': 900, 'million': 1800}
HANG_S = 30  # robustness: a file that takes longer is a hang
PAGE_SIZE = os.sysconf('SC_PAGE_SIZE') if hasattr(os, 'sysconf') else 4096
WIN = os.name == 'nt'


def sh(*cmd, timeout=600, **kw):
    try:
        return subprocess.run([str(c) for c in cmd], capture_output=True, text=True, timeout=timeout, encoding='utf-8', errors='replace', **kw)
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


SCOPE = None  # set in main: a systemd-run prefix that puts a run in its own cgroup with MemoryMax (a hard cap)


def find_scope(cap_mb):
    if WIN:
        return None
    for pre in (['systemd-run', '--user', '--scope', '-q'], ['sudo', '-n', 'systemd-run', '--scope', '-q', f'--uid={os.getuid()}', f'--gid={os.getgid()}', '-E', 'HOME', '-E', 'PATH']):
        args = pre + ['-p', f'MemoryMax={cap_mb}M', '-p', 'MemorySwapMax=0']
        if sh(*args, 'true', timeout=30).returncode == 0:
            return args
    return None


def run_once(cmd, env, timeout, cap_mb, watch=None):
    """One process. Returns a dict with status ok|error|crash|timeout|oom and the measurements. With SCOPE the kernel
    enforces the cap (cgroup MemoryMax, a SIGKILL = oom); the 100 ms RSS poll below enforces it either way."""
    if SCOPE:
        cmd = SCOPE + (['--setenv=' + f'{k}={v}' for k, v in env.items()] if SCOPE[0] == 'sudo' else []) + ['--'] + list(cmd)
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
    signaled = os.WIFSIGNALED(status)
    return finish(r, out, env, killed, signaled and os.WTERMSIG(status) == signal.SIGKILL, signaled, 0 if signaled else os.WEXITSTATUS(status))


def finish(r, out, env, killed, sigkill, signaled, code):
    """The run's status from what run_once / run_once_win saw."""
    line = next((l for l in reversed(out.decode('utf-8', 'replace').splitlines()) if l.startswith('{')), None)
    try:
        r['h'] = json.loads(line) if line else {}
    except ValueError:
        r['h'] = {}
    tail = Path(env['BENCH_LOG']).read_text(errors='replace')[-4000:]
    if killed:
        r['status'] = killed
    elif signaled:
        r['status'] = 'oom' if sigkill else 'crash'  # SIGKILL from outside: the kernel's OOM killer
    elif code == 0 and r['h'].get('ok'):
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


if WIN:
    import ctypes
    from ctypes import wintypes

    class _PMC(ctypes.Structure):
        _fields_ = [('cb', wintypes.DWORD), ('PageFaultCount', wintypes.DWORD)] + [(n, ctypes.c_size_t) for n in (
            'PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
            'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage')]

    _k32 = ctypes.WinDLL('kernel32')
    _k32.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(_PMC), wintypes.DWORD]
    _k32.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4

    def _mem(h):
        m = _PMC()
        m.cb = ctypes.sizeof(m)
        _k32.K32GetProcessMemoryInfo(h, ctypes.byref(m), m.cb)
        return m

    def _cpu_ms(h):
        ft = [wintypes.FILETIME() for _ in range(4)]  # creation, exit, kernel, user (100 ns units)
        _k32.GetProcessTimes(h, *[ctypes.byref(f) for f in ft])
        return sum((f.dwHighDateTime << 32 | f.dwLowDateTime) / 1e4 for f in ft[2:])


def run_once_win(cmd, env, timeout, cap_mb, watch=None):
    """run_once on Windows: one process (no process groups or rusage), measured through its handle, which stays open
    after it exits: CPU from GetProcessTimes, peak RSS = its peak working set; the cap is enforced on the working set."""
    t0 = time.perf_counter()
    try:
        with open(env['BENCH_LOG'], 'w') as log:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log, env=env)
    except OSError as e:  # e.g. a contestant whose build failed: not started
        return {'wall_ms': 0, 'cpu_ms': 0, 'rss_mb': 0, 'ttfb_ms': None, 'h': {}, 'status': 'crash', 'error': repr(e)[:600]}
    chunks = []
    reader = threading.Thread(target=lambda: chunks.append(p.stdout.read()), daemon=True)
    reader.start()
    h = wintypes.HANDLE(int(p._handle))
    ttfb, killed = None, None
    while p.poll() is None:
        el = time.perf_counter() - t0
        if watch and ttfb is None and os.path.exists(watch) and os.path.getsize(watch) > 0:
            ttfb = el * 1000
        if killed is None and (el > timeout or _mem(h).WorkingSetSize > cap_mb * 2**20):
            killed = 'timeout' if el > timeout else 'oom'
            p.kill()
        time.sleep(0.1 if el > 1 else 0.02)
    wall = (time.perf_counter() - t0) * 1000
    reader.join(10)
    r = {'wall_ms': wall, 'cpu_ms': _cpu_ms(h), 'rss_mb': _mem(h).PeakWorkingSetSize / 2**20, 'ttfb_ms': ttfb}
    return finish(r, b''.join(c for c in chunks if c), env, killed, False, False, p.returncode)


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
    m = sh('mutool', 'draw', '-q', '-F', 'txt', '-o', os.devnull, pdf, f'1,{n}', timeout=900)
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


def check_bulk(kind, out, fx, spec):
    """Every file: present and qpdf --check clean with the right page count; 20 spread over the run: the kind's full check."""
    files = sorted(out.glob('b-*.pdf'))
    bad = []
    for f in files:
        q = sh('qpdf', '--check', f, timeout=120)
        n = npages(f)
        if q.returncode not in (0, 3) or not n or (kind == 'plain' and n != BULK_KINDS['plain']):
            bad.append(f.name)
    sample, sampled = files[::max(1, len(files) // 20)][:20] + files[-1:], {}
    for f in sample:
        d = out / ('s-' + f.stem)
        d.mkdir()
        os.link(f, d / 'out.pdf')
        rec, ok = check(kind, BULK_KINDS[kind], d, fx, spec, {})
        sampled[f.name] = ok if kind != 'pdfa' else ok and rec.get('pdfa') is not False
    t = {'files': len(files), 'qpdf_bad': bad[:20], 'n_bad': len(bad), 'sampled': len(sampled), 'sample_bad': [k for k, v in sampled.items() if not v]}
    t['ok'] = len(files) == BULK_N and not bad and not t['sample_bad']
    return {'text': t, 'bytes': sum(f.stat().st_size for f in files)}, t['ok']


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
            if not t['ok']:
                t['lastPage'] = re.sub(r'\s+', ' ', a)[-200:]  # what the check saw, to tell a harness bug from the library
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
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)


def slug(s):
    return re.sub(r'[^\w.-]+', '_', s)


def cells(parts, job, size, a, fx, spec, work):
    """One (job, size) for every contestant in parts, interleaved run by run (A, B, C, A, B, C...) so drift in the
    machine's speed spreads over all of them. parts: dicts with label, lang, c (contestants.json entry), extra fields."""
    base = {p['label']: {'type': 'cell', 'lang': p['lang'], 'lib': p['label'], 'version': p['c'].get('_version'), 'job': job, 'size': size,
                         **p.get('tag', {})} for p in parts}
    out = {p['label']: work / slug(f"{p['label']}-{job}-{size}") for p in parts}
    env = lambda p, o, extra={}: env_for(fx, o, {**p.get('env', {}), **extra})
    if job in ROBUST:
        files = sorted((fx / spec['robust']['fuzzDir' if job == 'fuzz' else 'hostileDir']).glob('*.pdf'))[:size]
        tally, cases = {p['label']: Counter() for p in parts}, {p['label']: {} for p in parts}
        for f in files:
            for p in parts:
                o = out[p['label']]
                clean(o)
                r = run_once(p['c']['cmd'] + ['parse', '1', str(o)], env(p, o, {'BENCH_INPUT': str(f)}), HANG_S, a.cap_mb)
                st = {'timeout': 'hang', 'error': 'clean-error'}.get(r['status'], r['status'])
                tally[p['label']][st] += 1
                if job == 'hostile' or st in ('crash', 'hang', 'oom'):
                    cases[p['label']][f.name] = st
        return [{**base[p['label']], 'status': 'ok', 'robust': dict(tally[p['label']]), 'cases': cases[p['label']], 'files': len(files)} for p in parts]
    heavy = (job == 'report' and size >= 10000) or job == 'read-big' or job == 'bulk'
    # quick is indicative: its heavy cells run once, without a warm-up; full keeps the warm-up and at most 3 runs there
    runs = 1 if a.tier == 'million' or job == 'bulk' or (heavy and a.tier == 'quick') else min(a.runs, 3) if heavy or size >= 100000 or a.tier == 'quick' else a.runs
    warmup = 0 if a.tier == 'million' or (heavy and a.tier == 'quick') else 1
    extra = {'REPS': '50'} if job == 'invoice-warm' else {'BULK': str(BULK_N)} if job == 'bulk' else {}
    jobarg = [size, BULK_KINDS[size]] if job == 'bulk' else [job, size]  # bulk runs the kind's own job, BULK_N times
    res, failed = {p['label']: [] for p in parts}, {}
    for i in range(warmup + runs):
        for p in parts:
            L = p['label']
            if L in failed:
                continue
            clean(out[L])
            r = run_once(p['c']['cmd'] + [str(x) for x in jobarg] + [str(out[L])], env(p, out[L], extra), 1800 if job == 'bulk' else CELL_TIMEOUT[a.tier], a.cap_mb,
                         watch=out[L] / 'out.pdf' if job in CREATE else None)
            if job == 'bulk' and r['status'] == 'ok' and r['h'].get('ms'):
                r['h']['note'] = f"{BULK_N} files, {BULK_N / r['h']['ms'] * 1000:.1f} files/s" + (f", {r['h']['note']}" if r['h'].get('note') else '')
            if r['status'] != 'ok':
                failed[L] = {**base[L], 'status': r['status'], 'error': r.get('error'), 'wall_ms': round(r['wall_ms']), 'rss_mb': round(r['rss_mb'], 1)}
                shutil.rmtree(out[L], ignore_errors=True)
            elif i >= warmup:
                res[L].append(r)
    recs = []
    for p in parts:
        L = p['label']
        if L in failed:
            recs.append(failed[L])
            continue
        rs = res[L]
        rec = {**base[L], 'status': 'ok', 'runs': runs,
               'cold_ms': stats([r['wall_ms'] for r in rs]),
               'warm_ms': stats([r['h'].get('warm_ms', r['h'].get('ms')) for r in rs]),
               'cpu_ms': stats([r['cpu_ms'] for r in rs]),
               'rss_mb': stats([r['rss_mb'] for r in rs]),
               'ttfb_ms': stats([r['ttfb_ms'] for r in rs]) if job in CREATE else None,
               'note': rs[-1]['h'].get('note')}
        try:
            more, ok = check_bulk(size, out[L], fx, spec) if job == 'bulk' else check(job, size, out[L], fx, spec, rs[-1]['h'])
            rec.update(more)
            if not ok:
                rec['status'] = 'invalid'
        except Exception as e:  # a checker bug must not lose the measurement
            rec.update(status='harness-error', error=repr(e)[:600])
        shutil.rmtree(out[L], ignore_errors=True)
        recs.append(rec)
    return recs


GROUPS = {  # same-machine layout: one job a group runs every contestant of its tables on one runner
    'create-writers': lambda job, c: job in CREATE and c.get('league') == 'writer',
    'create-engines': lambda job, c: job in CREATE and c.get('league') == 'engine',
    'read-edit': lambda job, c: job not in CREATE and job not in ROBUST,
    'robustness': lambda job, c: job in ROBUST,
    'bulk': lambda job, c: job == 'bulk' and c.get('league') == 'engine',
}


def meta(a, langs):
    proc = lambda f: Path(f).read_text() if Path(f).exists() else ''  # Linux; Windows: platform's CPU name, RAM in the runner file
    cpu = re.search(r'model name\s*:\s*(.*)', proc('/proc/cpuinfo'))
    mem = re.search(r'MemTotal:\s*(\d+)', proc('/proc/meminfo'))
    first = lambda r: (r.stdout + r.stderr).strip().splitlines()[0:1]
    tools = {t: first(sh(*cmd)) for t, cmd in {
        'qpdf': ['qpdf', '--version'], 'mutool': ['mutool', '-v'], 'pdftotext': ['pdftotext', '-v'],
        'verapdf': ['verapdf', '--version']}.items()}
    for l in a.langs:
        rt = langs[l].get('runtime')
        if rt:
            r = sh(*rt)
            tools['runtime' if not a.group else f'runtime {l}'] = (r.stdout + r.stderr).strip().splitlines()[0:2]
    return {'type': 'meta', 'lang': a.group or a.lang, **({'group': a.group, 'langs': a.langs} if a.group else {}),
            'tier': a.tier, 'runs': a.runs, 'date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'cpu': cpu.group(1).strip() if cpu else platform.processor(), 'cores': os.cpu_count(),
            'ram_mb': int(mem.group(1)) // 1024 if mem else None, 'os': platform.platform(), 'cap_mb': a.cap_mb,
            'runner': os.environ.get('RUNNER_NAME'), 'tools': tools, 'run_id': os.environ.get('GITHUB_RUN_ID'),
            'mem_cap': ('cgroup MemoryMax ' if SCOPE else 'RSS poll ') + f'{a.cap_mb} MB', **({'only': a.only} if a.only else {}),
            **({'source': os.environ['BENCH_SOURCE']} if os.environ.get('BENCH_SOURCE') else {})}  # branch builds: 'engine <ref>@<sha>,pdf <ref>@<sha>'


def contestants(a, langs, fx, work):
    """The contestants to run, each version-checked. In a group, ours runs as the npm build and, when
    bench/deep/ours-branch was built (BENCH_SRC_ENGINE / BENCH_SRC_PDF), as the branch build too."""
    parts, broken = [], []
    for lang in a.langs:
        for lib, c in langs[lang]['libs'].items():
            if a.tier == 'million' and not c.get('million'):
                continue
            if a.group == 'bulk' and lib not in BULK_LIBS:
                continue
            vs = [{'label': lib, 'lang': lang, 'c': dict(c), 'tag': {}}]
            if a.group == 'bulk' and lang == 'ours':
                src = os.environ.get('BENCH_SRC_ENGINE')
                if src and (HERE / 'ours-branch').is_dir():
                    c = {**c, 'cmd': [x.replace('bench/deep/ours/', 'bench/deep/ours-branch/') for x in c['cmd']]}
                n = os.cpu_count()
                vs = [{'label': f'{lib} ({"branch " + src if src else "npm"})', 'lang': lang, 'c': dict(c), 'tag': {'base': lib, 'variant': 'single'}},
                      {'label': f'{lib} ({"branch " + src if src else "npm"}, pool)', 'lang': lang, 'c': dict(c),
                       'env': {'BENCH_POOL': str(n), 'BULK_CONC': str(n * 2)}, 'tag': {'base': lib, 'variant': 'pool', 'workers': n}}]
            elif a.group and lang == 'ours':
                vs[0]['tag'] = {'base': lib, 'variant': 'npm'}
                src = os.environ.get('BENCH_SRC_' + ('ENGINE' if 'engine' in lib else 'PDF'))
                if src and (HERE / 'ours-branch').is_dir():
                    bc = {**c, 'cmd': [x.replace('bench/deep/ours/', 'bench/deep/ours-branch/') for x in c['cmd']]}
                    if a.tier == 'million' and 'engine' in lib:
                        vs += [{'label': f'{lib} (branch {src}, parallel off)', 'lang': lang, 'c': dict(bc), 'tag': {'base': lib, 'variant': 'branch'}},
                               {'label': f"{lib} (branch {src}, parallel 'auto')", 'lang': lang, 'c': dict(bc), 'env': {'BENCH_PARALLEL': 'auto'},
                                'tag': {'base': lib, 'variant': 'branch-parallel'}}]
                    else:
                        vs.append({'label': f'{lib} (branch {src})', 'lang': lang, 'c': dict(bc), 'tag': {'base': lib, 'variant': 'branch'}})
            for p in vs:
                v = run_once(p['c']['cmd'] + ['version', '0', str(work)], env_for(fx, work / 'v', p.get('env')), 300, a.cap_mb)
                p['c']['_version'] = v['h'].get('version') if v['status'] == 'ok' else None
                if p['tag'].get('variant') == 'npm':
                    p['label'] = f"{lib} {(p['c']['_version'] or '?').split()[0]} (npm)"
                if v['status'] != 'ok':
                    broken.append({'type': 'cell', 'lang': lang, 'lib': p['label'], 'job': 'version', 'size': 0, 'status': v['status'], 'error': v.get('error'), **p['tag']})
                else:
                    parts.append(p)
    return parts, broken


FAILS = ('timeout', 'oom', 'error', 'crash')
KEEP_RATIO = 1.2


def prune_plan(prev_path, langs):
    """From a previous merged results.json: per (job, league) the non-ours contestants to drop, {(job, league): {lib: (ratio, size)}},
    and the previous run id. Kept: ours; anything at most 1.2x our best row at the largest size both completed; any contestant
    with no shared size, or valid where ours is invalid. A job where ours has no valid result is not pruned. Robustness never is."""
    j = json.loads(Path(prev_path).read_text())
    src = j['sources'][0] if 'sources' in j else j
    m = re.search(r'runs? ([\d+ ]+)', src.get('label', ''))
    run = m.group(1).strip() if m else '?'
    league = {lib: c.get('league') for l in langs.values() for lib, c in l['libs'].items()}
    t = lambda r: (r.get('cold_ms') or r.get('warm_ms') or {}).get('median') if r['job'] != 'invoice-warm' else (r.get('warm_ms') or r.get('cold_ms') or {}).get('median')
    by = {}
    for r in src['cells']:
        if r.get('job') in ROBUST or r.get('job') == 'version':
            continue
        lg = league.get(r.get('base') or r['lib']) if r['job'] in CREATE else 'read-edit'
        by.setdefault((r['job'], lg), []).append(r)
    drop = {}
    for key, rs in by.items():
        ours = [r for r in rs if r['lang'] == 'ours']
        if not any(r['status'] == 'ok' for r in ours):
            continue  # rule 4: ours has no valid result in this job
        drop[key] = {}  # judged here, even if nobody is dropped
        best = {}
        for r in ours:
            if r['status'] == 'ok' and t(r):
                best[r['size']] = min(best.get(r['size'], 1e18), t(r))
        bad_ours = {r['size'] for r in ours if r['status'] != 'ok'} - set(best)
        for lib in {r['lib'] for r in rs if r['lang'] != 'ours'}:
            mine = {r['size']: r for r in rs if r['lib'] == lib}
            if any(r['status'] == 'ok' for sz, r in mine.items() if sz in bad_ours):
                continue  # rule 4: valid where ours is invalid
            shared = [sz for sz, r in mine.items() if sz in best and r['status'] == 'ok' and t(r)]
            if not shared:
                continue
            sz = max(shared)
            ratio = t(mine[sz]) / best[sz]
            if ratio > KEEP_RATIO:
                drop[key][lib] = (round(ratio, 2), sz)
    return drop, run


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--lang', help='one language (the per-language layout)')
    p.add_argument('--group', choices=list(GROUPS), help='a job group over --langs on this one machine (the same-machine layout)')
    p.add_argument('--langs', default='ours,js,python,java,dotnet,go,rust,cli')
    p.add_argument('--tier', default='quick', choices=list(PLAN))
    p.add_argument('--runs', type=int, default=5)
    p.add_argument('--fixtures', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--work', default='/tmp/deep-work')
    p.add_argument('--cap-mb', type=int, default=int(os.environ.get('MEM_CAP_MB', '4000')))
    p.add_argument('--prune', default='', help="a previous merged results.json: drop contestants more than 1.2x slower than ours there")
    p.add_argument('--only', default='', help='comma list of jobs, for a partial rerun or to split a group')
    a = p.parse_args()
    assert bool(a.lang) != bool(a.group), 'give --lang or --group'
    global SCOPE, run_once
    SCOPE = find_scope(a.cap_mb)
    if WIN:
        run_once = run_once_win
    a.langs = [a.lang] if a.lang else [l.strip() for l in a.langs.split(',') if l.strip()]
    fx, work = Path(a.fixtures).resolve(), Path(a.work)
    spec = json.loads((fx / 'spec.json').read_text())
    langs = json.loads((HERE / 'contestants.json').read_text())['langs']
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    plan = {**({} if a.tier == 'million' else DEFAULT_SIZES), **PLAN[a.tier]}
    if a.group == 'bulk':
        plan = {'bulk': list(BULK_KINDS)}
    with open(a.out, 'w') as o:
        def emit(rec):
            if a.group:
                rec['group'] = a.group
            o.write(json.dumps(rec, ensure_ascii=False) + '\n')
            o.flush()
            print(json.dumps({k: rec.get(k) for k in ('lib', 'job', 'size', 'status', 'cold_ms', 'robust')}), flush=True)
        emit(meta(a, langs))
        parts, broken = contestants(a, langs, fx, work)
        for r in broken:
            emit(r)
        drop, prev_run = {}, None
        for f in [f for f in a.prune.split(',') if f and Path(f).exists()]:  # the first file that judged a (job, league) decides it
            d, r = prune_plan(f, langs)
            for k, v in d.items():
                if k not in drop:
                    drop[k] = {lib: (*x, r) for lib, x in v.items()}
        lg = lambda pt, job: pt['c'].get('league') if job in CREATE else 'read-edit'
        does = lambda pt, job: (job == 'bulk' or ('parse' if job in ROBUST else job) in pt['c']['jobs']) and (not a.group or GROUPS[a.group](job, pt['c']))
        batches = [parts] if a.group else [[pt] for pt in parts]  # a group interleaves everyone; a language runs lib by lib
        for batch in batches:
            for job in JOBS:
                if job not in plan or (a.only and job not in a.only.split(',')):
                    continue
                todo = [pt for pt in batch if does(pt, job)]
                for pt in list(todo):
                    d = drop.get((job, lg(pt, job)), {}).get(pt['label'])
                    if d and pt['lang'] != 'ours':
                        todo.remove(pt)
                        emit({'type': 'cell', 'lang': pt['lang'], 'lib': pt['label'], 'job': job, 'size': d[1], 'status': 'pruned',
                              'ratio': d[0], 'prev_run': d[2], 'league': lg(pt, job)})
                dead = {}
                for size in plan[job] if todo else []:
                    for pt in todo:
                        if pt['label'] in dead:
                            emit({'type': 'cell', 'lang': pt['lang'], 'lib': pt['label'], 'version': pt['c'].get('_version'), 'job': job, 'size': size,
                                  'status': 'skipped', 'error': f'skipped after {dead[pt["label"]][0]} at {dead[pt["label"]][1]:,}', **pt.get('tag', {})})
                    live = [pt for pt in todo if pt['label'] not in dead]
                    if job == 'bulk':  # a contestant without the kind stays n/a with its existing reason
                        for pt in [pt for pt in live if size not in pt['c']['jobs']]:
                            live.remove(pt)
                            emit({'type': 'cell', 'lang': pt['lang'], 'lib': pt['label'], 'job': job, 'size': size, 'status': 'n/a',
                                  'error': pt['c'].get('na', {}).get(size) or pt['c'].get('na', {}).get('create') or 'not supported', **pt.get('tag', {})})
                    if not live:
                        continue
                    try:
                        for rec in cells(live, job, size, a, fx, spec, work):
                            emit(rec)
                            if rec['status'] in FAILS and job not in ROBUST and job != 'bulk':
                                dead[rec['lib']] = (rec['status'], size)
                    except Exception as e:  # a bug here must not lose the other cells
                        for pt in todo:
                            emit({'type': 'cell', 'lang': pt['lang'], 'lib': pt['label'], 'version': pt['c'].get('_version'), 'job': job, 'size': size,
                                  'status': 'harness-error', 'error': repr(e)[:600], **pt.get('tag', {})})


if __name__ == '__main__':
    main()
