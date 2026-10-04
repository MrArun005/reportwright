#!/bin/sh
# Rebuild and restart the production server for the e2e tests (dev helper). PORT defaults to 3000.
# Stops only a Next server on that port that runs from this folder; works on macOS and Linux.
cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-3000}
for pid in $(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null); do
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -qx "n$PWD" && kill "$pid"
done
sleep 1
PW_EMBED_ORIGINS=${PW_EMBED_ORIGINS:-http://localhost:4000} npm run build > /tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }
# The api e2e test receives webhooks on 127.0.0.1, which the SSRF guard blocks unless listed.
# A production server with no sign-in refuses everything (proxy.js): the e2e suites run as an app behind a
# signing-in reverse proxy (PW_AUTH=proxy); users.mjs and sso.mjs start their own servers with accounts.
PW_AUTH=${PW_AUTH:-proxy} PW_API_KEYS=${PW_API_KEYS:-test-key} PW_WEBHOOK_SECRET=${PW_WEBHOOK_SECRET:-testsecret} PW_INTERNAL_HOSTS=${PW_INTERNAL_HOSTS:-127.0.0.1} \
  nohup npx next start -p "$PORT" > /tmp/next.log 2>&1 < /dev/null &
sleep 5
curl -s -o /dev/null -w "server %{http_code} on :$PORT\n" "localhost:$PORT/"
