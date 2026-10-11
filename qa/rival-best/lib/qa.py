"""QA contract output shared by qa-pdf-libs, qa-engines and qa-rival-best.

emit(rows, suite, outdir): writes results.json + summary.md and appends the table to $GITHUB_STEP_SUMMARY.
A row is {suite, check, command, expected, actual, result, ms?, mb?}; result is PASS/FAIL/WARN/SKIP.
"""
import json, os, pathlib

RESULTS = ('PASS', 'FAIL', 'WARN', 'SKIP')


def trim(s, n=160):
    s = ' '.join(str(s).split()).replace('|', '/')
    return s if len(s) <= n else s[:n - 1] + '…'


def summary_md(rows, suite):
    n = {k: sum(r['result'] == k for r in rows) for k in RESULTS}
    out = [f'### qa-{suite}', '', '| Check | Command | Expected | Actual (trimmed) | Result |', '|---|---|---|---|---|']
    out += [f"| {trim(r['check'], 90)} | `{trim(r['command'], 80)}` | {trim(r['expected'], 80)} | {trim(r['actual'])} | {r['result']} |" for r in rows]
    out += ['', f"SUITE {suite}: {n['PASS']} PASS, {n['FAIL']} FAIL, {n['WARN']} WARN, {n['SKIP']} SKIP"]
    return '\n'.join(out) + '\n'


def emit(rows, suite, outdir):
    for r in rows:
        r['suite'] = suite
        assert r['result'] in RESULTS, r
    d = pathlib.Path(outdir)
    d.mkdir(parents=True, exist_ok=True)
    (d / 'results.json').write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    md = summary_md(rows, suite)
    (d / 'summary.md').write_text(md)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
            f.write(md)
    print(md.splitlines()[-1])


if __name__ == '__main__':  # self-check
    import tempfile
    rows = [{'check': 'a|b', 'command': 'x', 'expected': 'y', 'actual': 'z', 'result': 'PASS'},
            {'check': 'c', 'command': 'x', 'expected': 'y', 'actual': 'z', 'result': 'SKIP'}]
    with tempfile.TemporaryDirectory() as t:
        emit(rows, 'demo', t)
        md = open(t + '/summary.md').read()
        assert md.rstrip().endswith('SUITE demo: 1 PASS, 0 FAIL, 0 WARN, 1 SKIP') and 'a/b' in md
        assert json.load(open(t + '/results.json'))[0]['suite'] == 'demo'
    print('ok')
