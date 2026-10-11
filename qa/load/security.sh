#!/usr/bin/env bash
# qa-security checks against a running server (server.sh started with QA_INTERNAL_HOSTS='' : no private host allowed).
# A canary listener on 127.0.0.1:9911 counts every request a server-side fetch makes to it; the server's env carries
# PW_QA_CANARY, which no expression may read. Usage: qa/load/security.sh [port]
set -u
PORT=${1:-3700}; B=http://localhost:$PORT; K='authorization: Bearer svc-a'
rec() { node qa/stress/rec.mjs "$@"; }
node -e 'let n=0;require("http").createServer((q,s)=>{n++;require("fs").writeFileSync("/tmp/canary-hits",String(n));s.end("{\"rows\":[{\"x\":\"CANARY-LEAKED\"}]}")}).listen(9911,"127.0.0.1")' & C=$!
echo 0 > /tmp/canary-hits; sleep 1
render() { curl -s -m 60 -o /tmp/out -w '%{http_code}' -H "$K" -H 'content-type: application/json' --data-binary @- "$B/api/v1/render"; }
inline() { # $1 data source JSON, $2 textbox value
  printf '{"format":"json","template":{"$schema":"reportwright/report@1","name":"Q","page":{"size":"A4"},"dataSources":[%s],"dataSets":[{"name":"D","source":"s","path":"$.rows"}],"sections":{"body":{"items":[{"type":"textbox","name":"T","x":0,"y":0,"w":400,"h":40,"value":%s}]}}}}' "$1" "$2"
}
# --- data-source abuse (SSRF) ---
for u in http://169.254.169.254/metadata/instance?api-version=2021-02-01 http://169.254.169.254/latest/meta-data/ http://127.0.0.1:9911/x http://localhost:9911/x 'http://[::1]:9911/x' http://2130706433:9911/x http://0x7f.0.0.1:9911/x http://127.0.0.1.nip.io:9911/x http://localtest.me:9911/x file:///etc/passwd; do
  before=$(cat /tmp/canary-hits)
  code=$(inline "{\"name\":\"s\",\"type\":\"rest\",\"method\":\"GET\",\"url\":\"$u\",\"headers\":{\"Metadata\":\"true\"}}" '"=First(Fields.x, \"D\")"' | render)
  after=$(cat /tmp/canary-hits); body=$(head -c 300 /tmp/out | tr -d '\n')
  leaked=$(grep -c -E 'CANARY-LEAKED|root:x:0|azEnvironment|compute|ami-id|instance-id' /tmp/out)
  rec "SSRF $u" "POST /api/v1/render, inline rest source $u" 'refused (no fetch reaches it, no data in the output)' "status $code; canary hits $before→$after; leaked=$leaked; $body" "$([ "$after" = "$before" ] && [ "$leaked" = 0 ] && echo PASS || echo FAIL)"
done
code=$(curl -s -m 30 -o /tmp/out -w '%{http_code}' -H "$K" "$B/api/data/proxy?url=http://169.254.169.254/latest/meta-data/")
rec 'SSRF via /api/data/proxy' 'GET /api/data/proxy?url=http://169.254.169.254/…' 'not 200' "status $code $(head -c 150 /tmp/out)" "$([ "$code" != 200 ] && echo PASS || echo FAIL)"
# --- expression injection ---
for e in '=constructor.constructor(\"return process.env.PW_QA_CANARY\")()' '=Fields.constructor.constructor(\"return process\")().env.PW_QA_CANARY' '={}.__proto__.constructor.constructor(\"return globalThis.process.env.PW_QA_CANARY\")()' '=Code.Eval(\"process.env.PW_QA_CANARY\")' '=Environ(\"PW_QA_CANARY\")' '=Globals.constructor.constructor(\"return this\")().process.env.PW_QA_CANARY' '=Parameters.__proto__.toString.constructor(\"return process.env.PW_QA_CANARY\")()'; do
  code=$(inline '{"name":"s","type":"json","data":{"rows":[{"x":1}]}}' "\"$e\"" | render)
  leak=$(grep -c qa-canary-7f3e91 /tmp/out)
  rec "expression injection $(cut -c1-40 <<<"$e")" "inline textbox value $e" 'no canary in the output; server answers' "status $code; canary in output: $leak; $(head -c 160 /tmp/out | tr -d '\n')" "$([ "$leak" = 0 ] && [ "$code" != 000 ] && echo PASS || echo FAIL)"
done
code=$(printf '{"template":"invoice-gallery","format":"pdf","parameters":{"x":"=constructor.constructor(\\"return process.exit(1)\\")()"}}' | render)
alive=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/v1/livez")
rec 'expression in a parameter value' 'parameters.x = "=constructor…process.exit(1)"' 'server alive (livez 200)' "render $code, livez $alive" "$([ "$alive" = 200 ] && echo PASS || echo FAIL)"
code=$(printf '{"format":"html","template":{"$schema":"reportwright/report@1","name":"Q","page":{"size":"A4"},"dataSources":[{"name":"s","type":"json","data":{"rows":[{"x":"<script>alert(1)</script><img src=x onerror=alert(2)>"}]}}],"dataSets":[{"name":"D","source":"s","path":"$.rows"}],"sections":{"body":{"items":[{"type":"textbox","name":"T","x":0,"y":0,"w":400,"h":40,"value":"=First(Fields.x, \\"D\\")"},{"type":"richtext","name":"R","x":0,"y":50,"w":400,"h":40,"value":"<b>{Fields.x}</b><script>alert(3)</script>"}]}}}}' | render)
raw=$(grep -c -E '<script>alert|<img src=x onerror' /tmp/out); ctx=$(grep -o -E '.{0,80}(<script>alert|<img src=x onerror).{0,40}' /tmp/out | head -3 | tr '\n' ' ')
rec 'HTML export escapes data' 'format html, field "<script>…", richtext with <script>' 'no unescaped <script>alert / <img onerror> in the HTML' "status $code; raw matches $raw; context: $ctx" "$([ "$code" = 200 ] && [ "$raw" = 0 ] && echo PASS || echo FAIL)"
# --- oversized inputs ---
rss() { ps -eo rss=,args= | grep -E 'next-server|next start' | grep -v grep | awk '{s+=$1} END {print int(s/1024)}'; }
for mb in 1 10 50 200; do
  node -e 'process.stdout.write("{\"template\":\"invoice-gallery\",\"data\":{\"big\":\""+"A".repeat(Number(process.argv[1])*1048576)+"\"}}")' $mb > /tmp/big.json
  r0=$(rss); t0=$(date +%s%N)
  code=$(curl -s -m 120 -o /tmp/out -w '%{http_code}' -H "$K" -H 'content-type: application/json' --data-binary @/tmp/big.json "$B/api/v1/render"); ms=$(( ($(date +%s%N) - t0) / 1000000 ))
  r1=$(rss); alive=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/v1/livez")
  # expected: a body limit answers 413 (a 4xx at all is a refusal; 400 "Send a JSON body" for a well-formed body is a WARN: wrong status)
  res=$([ "$alive" != 200 ] && echo FAIL || { [ "$mb" -le 10 ] && echo PASS; } || { [ "$code" = 413 ] && echo PASS; } || { [ "${code:0:1}" = 4 ] && echo WARN; } || echo FAIL)
  rec "oversized body ($mb MB valid JSON)" "POST /api/v1/render with a $mb MB body" '≤10 MB: any answer, server alive; larger: 413, server alive, RSS bounded' "status $code in $ms ms; server RSS $r0→$r1 MB; livez $alive; $(head -c 100 /tmp/out)" "$res"
done
code=$(printf '{"format":"json","template":{"$schema":"reportwright/report@1","name":"Q","page":{"size":"A4"},"sections":{"body":{"items":[{"type":"richtext","name":"R","x":0,"y":0,"w":400,"h":40,"value":"%s"}]}}}}' "$(head -c 300000 /dev/zero | tr '\0' 'x')" | render)
rec 'oversized rich text (300k chars)' 'richtext value of 300,000 characters' 'cut at 100,000 with a warning (API.md)' "status $code; warning: $(grep -o '[^"]*cut[^"]*' /tmp/out | head -1)" "$([ "$code" = 200 ] && grep -qi 'cut\|limit' /tmp/out && echo PASS || echo FAIL)"
code=$(printf '{"format":"json","template":{"$schema":"reportwright/report@1","name":"Q","page":{"size":"A4"},"sections":{"body":{"items":[{"type":"textbox","name":"T","x":0,"y":0,"w":400,"h":40,"value":"=%s1%s"}]}}}}' "$(printf '(%.0s' $(seq 5000))" "$(printf ')%.0s' $(seq 5000))" | render)
alive=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/v1/livez")
rec 'expression nested 5,000 deep' 'textbox value =((((…1…))))' 'an error or #Error, no crash; livez 200' "status $code; livez $alive; $(head -c 120 /tmp/out)" "$([ "$alive" = 200 ] && [ "$code" != 000 ] && [ "$code" -lt 500 ] && echo PASS || echo FAIL)"
# --- authentication ---
for p in /api/v1/templates /api/reports /api/users /api/audit /api/v1/health '/api/reports/invoice-gallery/pdf'; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$B$p")
  rec "anonymous GET $p" "curl $p (no key, no session)" '401/403 (or a redirect to sign-in)' "$c" "$(case $c in 401|403|302|303|307) echo PASS;; *) echo FAIL;; esac)"
done
c=$(printf '{"template":"invoice-gallery"}' | curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' --data-binary @- "$B/api/v1/render")
rec 'anonymous POST /api/v1/render' 'no key' '401' "$c" "$([ "$c" = 401 ] && echo PASS || echo FAIL)"
c2=$(curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer SVC-A' "$B/api/v1/templates")
rec 'wrong-case key refused' 'Bearer SVC-A' '401' "$c2" "$([ "$c2" = 401 ] && echo PASS || echo FAIL)"
codes=""; for i in $(seq 1 21); do codes+="$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: $B" -H "X-Forwarded-For: 203.0.113.$i" -H "X-Real-IP: 198.51.100.$i" -H 'content-type: application/json' -d "{\"email\":\"forge$i@qa.test\",\"password\":\"wrong\"}" "$B/api/auth/login") "; done
last=$(awk '{print $NF}' <<<"$codes")
rec 'forged X-Forwarded-For does not bypass the login throttle' '21 failed logins, each with a new X-Forwarded-For / X-Real-IP' 'the 21st is 429 (PW_TRUSTED_PROXIES unset)' "$codes" "$([ "$last" = 429 ] && echo PASS || echo FAIL)"
kill $C
