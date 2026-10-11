#!/usr/bin/env bash
# Start the built server as the e2e accounts job does (PW_AUTH=users, a first admin, two service keys; default file storage, so the repository reports/ are the templates),
# wait for livez, and sign in as the first admin (a result row). Usage: qa/load/server.sh [port]
set -u
PORT=${1:-3700}
export PW_AUTH=users PW_SESSION_SECRET=$(openssl rand -hex 32) PW_DATA_KEY=$(openssl rand -hex 32) \
  PW_ADMIN_EMAIL=admin@qa.test PW_ADMIN_PASSWORD='qa admin password 123' \
  PW_API_KEYS="svc-a,svc-b" PW_INTERNAL_HOSTS="${QA_INTERNAL_HOSTS-127.0.0.1}" PW_QA_CANARY=qa-canary-7f3e91 PW_BASE_URL=http://localhost:$PORT
nohup npx next start -p "$PORT" > /tmp/next-qa.log 2>&1 &
for i in $(seq 1 120); do curl -sf "http://localhost:$PORT/api/v1/livez" >/dev/null && break; sleep 1; done
B=http://localhost:$PORT
code=$(curl -s -o /tmp/login.json -w '%{http_code}' -c /tmp/jar -H "Origin: $B" -H 'content-type: application/json' \
  -d '{"email":"admin@qa.test","password":"qa admin password 123"}' "$B/api/auth/login")
me=$(curl -s -b /tmp/jar "$B/api/auth/me" | head -c 200)
node qa/stress/rec.mjs 'boot + first admin sign-in' 'next start (PW_AUTH=users); POST /api/auth/login; GET /api/auth/me' \
  '200 and /me names admin@qa.test' "login $code; me: $me" "$( [ "$code" = 200 ] && grep -q admin@qa.test <<<"$me" && echo PASS || echo FAIL)"
