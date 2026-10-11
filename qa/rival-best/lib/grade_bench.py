"""Grade the deep benchmark's merged results.json (artifact <prefix>bench-deep-results) into QA rows.

usage: grade_bench.py <results.json> <suite> <libs|engines> <outdir> [--expect "rival=why-it-matters" ...]

Per table row and per build of ours: ours vs the fastest valid rival (the leader), ratio and rank.
  libs:    PASS if #1, or the leader is C/Go/Rust (lang go/rust/cli) and we are within 2x and faster than every
           Python/JS contestant. Java/.NET leaders are not covered by the 2x allowance: we must beat them.
  engines: PASS only if #1 among engines.
  else WARN within 3x, FAIL beyond. Our output invalid, crashed or missing = FAIL (validity).
  fuzz/hostile: FAIL on any crash/hang/oom of ours, else PASS.
"""
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from qa import emit

FAST_ALLOWED = {'go', 'rust', 'cli'}
SCRIPT = {'python', 'js'}
LEAGUES = {'libs': {'writer', 'read-edit'}, 'engines': {'engine'}}


def t_of(c):
    m = c.get('warm_ms') if c['job'] == 'invoice-warm' else c.get('cold_ms')
    return m and m['median']


def grade(data, mode):
    rows, seen = [], set()
    for src in data['sources']:
        for t in src['tables']:
            if t['league'] not in LEAGUES[mode]:
                continue
            job = t['job']
            cmd = f"python3 bench/deep/drive.py --only {job}" + (' (windows-latest)' if 'windows' in src['label'] else '')
            for row in t['rows']:
                cells = row['cells']
                seen.update(l for l, c in cells.items() if c)
                for o in t['ours']:
                    r = cells.get(o)
                    check = f"{t['title']} @ {row['size']} [{o}]"
                    base = {'check': check, 'command': cmd}
                    if job in ('fuzz', 'hostile'):
                        rb = (r or {}).get('robust', {})
                        bad = sum(rb.get(k, 0) for k in ('crash', 'hang', 'oom'))
                        rows.append({**base, 'expected': 'no crash/hang/oom on hostile input', 'actual': json.dumps(rb) if r else 'no result',
                                     'result': 'FAIL' if bad or not r else 'PASS'})
                        continue
                    riv = sorted((t_of(c), l, c) for l, c in cells.items() if l not in t['ours'] and c and c['status'] == 'ok' and t_of(c))
                    exp = '#1 among engines' if mode == 'engines' else '#1, or <=2x of a C/Go/Rust leader and faster than all Python/JS'
                    if r is None or r['status'] != 'ok' or not t_of(r):
                        st = r['status'] if r else 'no result'
                        rows.append({**base, 'expected': exp + '; valid output', 'actual': f"ours {st}: {(r or {}).get('error') or (r or {}).get('valid') or ''}",
                                     'result': 'FAIL'})
                        continue
                    ms, mb = t_of(r), (r.get('rss_mb') or {}).get('median')
                    if not riv:
                        rows.append({**base, 'expected': exp, 'actual': f'ours {ms:.0f} ms; no valid rival', 'result': 'PASS', 'ms': ms, 'mb': mb})
                        continue
                    lt, leader, lc = riv[0]
                    rank = 1 + sum(1 for x in riv if x[0] < ms)
                    ratio = ms / lt
                    if rank == 1:
                        res = 'PASS'
                    elif mode == 'libs' and lc.get('lang') in FAST_ALLOWED and ratio <= 2 and not any(x[0] < ms and x[2].get('lang') in SCRIPT for x in riv):
                        res = 'PASS'
                    else:
                        res = 'WARN' if ratio <= 3 else 'FAIL'
                    rows.append({**base, 'expected': exp, 'ms': ms, 'mb': mb, 'result': res,
                                 'actual': f"ours {ms:.0f} ms{f' {mb:.0f} MB' if mb else ''} vs leader {leader} ({lc.get('lang')}) {lt:.0f} ms = {ratio:.2f}x, rank {rank}/{len(riv) + 1}"})
    return rows, seen


def main():
    a = sys.argv[1:]
    path, suite, mode, outdir = a[:4]
    expect = [x.split('=', 1) for x in a[5::2]] if len(a) > 4 else []
    rows = []
    if pathlib.Path(path).exists():
        rows, seen = grade(json.load(open(path)), mode)
        for name, why in expect:
            if not any(name.lower() in s.lower() for s in seen):
                rows.append({'check': f'rival {name} present', 'command': 'bench-deep-run.yml', 'expected': f'{name} ran', 'actual': f'did not run: {why}', 'result': 'SKIP'})
    else:
        rows.append({'check': 'benchmark produced results', 'command': 'bench-deep-run.yml', 'expected': 'merged results.json', 'actual': 'missing (see the bench jobs)', 'result': 'FAIL'})
    emit(rows, suite, outdir)


if __name__ == '__main__':
    main()
