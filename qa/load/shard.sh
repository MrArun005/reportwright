#!/usr/bin/env bash
# One qa-load shard against a running server (server.sh). Usage: qa/load/shard.sh <ramp|spike|limits|soak> [port]
# Thresholds (PASS/FAIL), and their basis:
#  - steady 20 VUs, one-page invoice: ok p95 < 800 ms (brief; SERVER-LOAD.md measured p50 123 ms at 50 VUs on an M2),
#    0 unexpected answers (anything but 200/429/503, or no answer), every 429/503 with Retry-After.
#  - ramp 1→50 VUs, mixed reports: 0 unexpected, every reject with Retry-After; p95 ≥ 3000 ms is a WARN (no documented basis).
#  - spike to 200 VUs on one key: 0 unexpected (overload is answered 429/503, never a reset or a 500), ≥1 reject seen.
#  - fairness: key A floods with 100 VUs, key B renders with 2 VUs: B gets 0 rejects (SERVER-LOAD.md: "a user with nothing
#    queued or running is always let in"), B ok p95 < 3000 ms WARN.
#  - login throttle: 20 failures per network per 10 min (self-host.yml) → the 21st answers 429.
#  - soak (quick 3 min, full 20 min) at 10 VUs mixed: RSS last third ≤ 1.25 × first third (SERVER-LOAD.md soak held RSS
#    within ±5%), ok p95 last third ≤ 1.5 × first third, 0 unexpected.
set -u
NAME=$1; PORT=${2:-3700}; B=http://127.0.0.1:$PORT; # not localhost: k6 tries ::1 first and next start listens on IPv4
 OUT=${QA_DIR:-qa-out}; mkdir -p "$OUT"
k6r() { # label, rules, env…
  local label=$1 rules=$2; shift 2; local f; f=$(tr -c 'A-Za-z0-9\n-' '_' <<<"$label")
  env BASE=$B "$@" k6 run --quiet --summary-export "$OUT/$f.json" qa/load/render.js > "$OUT/$f.log" 2>&1
  node qa/load/judge.mjs "$label" "$OUT/$f.json" "$rules" "k6 run render.js $(echo "$@" | sed 's/KEY=[^ ]*//')"
}
alive() { local c; c=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/v1/livez"); node qa/stress/rec.mjs "server alive after $1" "GET /api/v1/livez" 200 "$c" "$([ "$c" = 200 ] && echo PASS || echo FAIL)"; }
# one render by curl first: its status and body explain a k6 run that gets no 200s
c=$(curl -s -o /tmp/one -w '%{http_code}' -H 'authorization: Bearer svc-a' -H 'content-type: application/json' -d '{"template":"invoice-gallery","format":"pdf"}' "$B/api/v1/render")
node qa/stress/rec.mjs 'one render by curl' 'POST /api/v1/render invoice-gallery (svc-a)' '200 PDF' "$c $(head -c 120 /tmp/one | tr -dc '[:print:]')" "$([ "$c" = 200 ] && echo PASS || echo FAIL)"
case "$NAME" in
  ramp)
    k6r 'warm-up 2 VUs' '{"unexpected":0}' KEY=svc-a MIX=mixed VUS=2 DURATION=20s
    k6r 'steady 20 VUs invoice' '{"p95":800,"unexpected":0,"noretry":0}' KEY=svc-a MIX=small VUS=20 DURATION=60s
    k6r 'ramp 1→50 VUs mixed' '{"unexpected":0,"noretry":0,"p95warn":3000}' KEY=svc-a MIX=mixed STAGES=10:30s,50:60s,50:60s,0:10s
    alive ramp ;;
  spike)
    # the pool's queue while the spike runs: shows whether the per-principal cap was ever reached
    (while true; do curl -s -m 3 -H 'authorization: Bearer svc-a' "$B/api/v1/health" | tr -d '\n'; echo; sleep 3; done) > "$OUT/health-spike.txt" & H=$!
    k6r 'spike 200 VUs one key' '{"unexpected":0,"noretry":0,"minRejected":1}' KEY=svc-a MIX=mixed STAGES=10:10s,200:10s,200:40s,0:10s
    kill $H
    node -e '
      const L=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
      const q=L.map(h=>h.render?.queue||{}),max=Math.max(0,...q.map(x=>x.interactive||0)),cap=q.find(x=>x.perPrincipalMax)?.perPrincipalMax;
      const t=L.at(-1)?.render?.totals||L.at(-1)?.render?.stats||{};
      require("child_process").execFileSync("node",["qa/stress/rec.mjs","pool queue during the spike","GET /api/v1/health every 3 s","context for the spike row (info)",
        `${L.length} samples; max interactive queue ${max}; perPrincipalMax ${cap}; last totals ${JSON.stringify(t).slice(0,200)}`,"PASS"],{stdio:"inherit"});' "$OUT/health-spike.txt"
    alive spike
    BASE=$B KEY=svc-a MIX=mixed VUS=100 DURATION=60s k6 run --quiet --summary-export "$OUT/flood-a.json" qa/load/render.js > "$OUT/flood-a.log" 2>&1 &
    sleep 10
    k6r 'fairness: key B beside a 100-VU flood of key A' '{"unexpected":0,"maxRejectedRate":0,"p95warn":3000}' KEY=svc-b MIX=small VUS=2 DURATION=40s
    wait
    node qa/load/judge.mjs 'fairness: the flooding key A' "$OUT/flood-a.json" '{"unexpected":0,"noretry":0,"minRejected":1}' 'k6 100 VUs key A'
    alive fairness ;;
  limits)
    # login throttle (no forged headers: that is qa-security's check)
    codes=""; for i in $(seq 1 21); do codes+="$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $B" -H 'content-type: application/json' -d "{\"email\":\"nobody$i@qa.test\",\"password\":\"wrong\"}" "$B/api/auth/login") "; done
    last=$(awk '{print $NF}' <<<"$codes"); first20=$(awk '{for(i=1;i<=20;i++) if($i==429) n++} END {print n+0}' <<<"$codes")
    node qa/stress/rec.mjs 'login throttle' '21 × POST /api/auth/login with wrong passwords' 'first 20 not 429, the 21st 429' "$codes" "$([ "$last" = 429 ] && [ "$first20" = 0 ] && echo PASS || echo FAIL)"
    h=$(curl -s -i -o - -H "Origin: $B" -H 'content-type: application/json' -d '{"email":"x@qa.test","password":"wrong"}' "$B/api/auth/login" | grep -i '^retry-after' | tr -d '\r')
    node qa/stress/rec.mjs 'login throttle Retry-After' 'POST /api/auth/login (throttled)' 'Retry-After header' "${h:-none}" "$([ -n "$h" ] && echo PASS || echo WARN)"
    hc=$(curl -s -H 'authorization: Bearer svc-a' "$B/api/v1/health" | head -c 300)
    node qa/stress/rec.mjs 'health endpoint' 'GET /api/v1/health (service key)' 'pool stats JSON' "$hc" "$(grep -q '"queue\|workers\|size' <<<"$hc" && echo PASS || echo FAIL)" ;;
  soak)
    total=$([ "${QA_TIER:-quick}" = full ] && echo 1200 || echo 180); third=$((total / 3))s
    qa/load/rss.sh "$OUT/rss.txt" & R=$!
    for t in 1 2 3; do k6r "soak third $t (10 VUs, $third)" '{"unexpected":0,"noretry":0}' KEY=svc-a MIX=mixed VUS=10 DURATION=$third; done
    kill $R
    node -e '
      const fs=require("fs"),o=process.argv[1];const r=fs.readFileSync(o+"/rss.txt","utf8").trim().split("\n").map(l=>+l.split(" ")[1]);
      const n=Math.floor(r.length/3),avg=a=>a.reduce((x,y)=>x+y,0)/a.length,a=avg(r.slice(0,n)),c=avg(r.slice(-n));
      const p=i=>{try{return JSON.parse(fs.readFileSync(`${o}/${`soak third ${i} (10 VUs, ${process.argv[2]})`.replace(/[^A-Za-z0-9-]/g,"_")}.json`)).metrics.ok_duration["p(95)"]}catch{return NaN}};
      const rec=(c2,e,a2,res)=>require("child_process").execFileSync("node",["qa/stress/rec.mjs",c2,"soak: rss.sh + k6 thirds",e,a2,res],{stdio:"inherit"});
      rec("soak RSS drift","RSS last third ≤ 1.25 × first third",`RSS first ${a.toFixed(0)} MB → last ${c.toFixed(0)} MB (×${(c/a).toFixed(2)}), samples ${r.length}`,c<=1.25*a?"PASS":"FAIL");
      rec("soak latency drift","p95 last third ≤ 1.5 × first third",`p95 ${p(1).toFixed(0)} → ${p(3).toFixed(0)} ms (×${(p(3)/p(1)).toFixed(2)})`,p(3)<=1.5*p(1)?"PASS":"FAIL");
    ' "$OUT" "$third"
    alive soak ;;
esac
exit 0 # the verdicts are the result rows (the report job fails on a FAIL)
