#!/usr/bin/env bash
# Command-line contestants: harness.sh <mutool|qpdf|pdftotext|pdfium> <job> <size> <outdir> -> one JSON line.
# The time is the tool's own process(es), measured here; pdfium runs through pypdfium2 (python/harness.py).
# A tool killed by a signal (exit >= 128) prints no result line, so the driver records a crash, not a clean error.
set -uo pipefail
lib=$1 job=$2 size=$3 out=$4
here=$(cd "$(dirname "$0")" && pwd)
[ "$lib" = pdfium ] && exec python3 "$here/../python/harness.py" pdfium "$job" "$size" "$out"
fx=$BENCH_FIXTURES
spec() { python3 -c "import json,sys;d=json.load(open('$fx/spec.json'));print(eval(sys.argv[1]))" "$1"; }

if [ "$job" = version ]; then
  case $lib in
    mutool) v=$(mutool -v 2>&1 | head -1) ;;
    qpdf) v=$(qpdf --version | head -1) ;;
    pdftotext) v=$(pdftotext -v 2>&1 | head -1) ;;
  esac
  printf '{"ok":true,"version":"%s"}\n' "$v"; exit 0
fi
mkdir -p "$out"
pdf=$out/out.pdf doc=$fx/$(spec "d['edit']['doc']") owner=$(spec "d['edit']['passwords']['owner']")
merge=$(ls "$fx/$(spec "d['edit']['mergeDir']")"/*.pdf | head -n "$size")
mixed=$(ls "$fx/$(spec "d['read']['mixedDir']")"/*.pdf)

text() { # <in> <out.txt>
  case $lib in
    mutool) mutool draw -q -F txt -o "$2" "$1" ;;
    pdftotext) pdftotext -enc UTF-8 "$1" "$2" ;;
    *) return 64 ;;
  esac
}
work() {
  case $lib:$job in
    *:read-big) text "$fx/$(spec "d['read']['big']")" "$out/out.txt" ;;
    *:read-mixed) for f in $mixed; do text "$f" "$out/$(basename "$f" .pdf).txt" || return; done ;;
    mutool:parse) mutool draw -q -F txt -o /dev/null "$BENCH_INPUT" ;;
    pdftotext:parse) pdftotext "$BENCH_INPUT" /dev/null ;;
    qpdf:parse) qpdf --check "$BENCH_INPUT" >/dev/null; r=$?; [ $r -eq 0 ] || [ $r -eq 3 ] ;;
    mutool:merge) mutool merge -o "$pdf" $merge ;;
    qpdf:merge) qpdf --empty --pages $merge -- "$pdf" ;;
    mutool:split) n=$(qpdf --show-npages "$doc" 2>/dev/null || mutool info "$doc" | awk '/^Pages:/{print $2}')
      for i in $(seq 1 "$n"); do mutool merge -o "$out/p-$(printf %04d "$i").pdf" "$doc" "$i" || return; done ;;
    qpdf:split) qpdf --split-pages "$doc" "$out/p-%d.pdf" ;;
    mutool:encrypt) mutool clean -E aes-256 -O "$owner" "$doc" "$pdf" ;;
    qpdf:encrypt) qpdf --encrypt "" "$owner" 256 -- "$doc" "$pdf" ;;
    *) echo "unsupported $lib $job" >&2; return 64 ;;
  esac
}
t0=$(date +%s%N)
work 2>"$out/.stderr"
rc=$?
ms=$(( ($(date +%s%N) - t0) / 1000000 ))
[ $rc -ge 128 ] && { cat "$out/.stderr" >&2; exit 1; }
[ "$lib" = qpdf ] && [ $rc -eq 3 ] && rc=0 # qpdf: 3 = succeeded with warnings
if [ $rc -eq 0 ]; then printf '{"ok":true,"ms":%s}\n' "$ms"
else printf '{"ok":false,"error":%s}\n' "$(tail -c 400 "$out/.stderr" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"; fi
rm -f "$out/.stderr"
