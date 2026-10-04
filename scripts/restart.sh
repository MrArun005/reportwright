#!/bin/sh
# Rebuild and restart the production server for the e2e tests (dev helper), then: BASE=http://localhost:$PORT npm run test:e2e
# PORT defaults to 3000; the app itself listens on PORT+1 behind scripts/e2e-proxy.mjs on PORT.
# Stops only servers on those ports that run from this folder; works on macOS and Linux.
cd "$(dirname "$0")/.." || exit 1
PORT=${PORT:-3000}
INNER=$((PORT + 1))
for p in "$PORT" "$INNER"; do
  for pid in $(lsof -ti tcp:"$p" -sTCP:LISTEN 2>/dev/null); do
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep -qx "n$PWD" && kill "$pid"
  done
done
sleep 1
PW_EMBED_ORIGINS=${PW_EMBED_ORIGINS:-http://localhost:4000} npm run build > /tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }
# A production server with no sign-in refuses everything (proxy.js). The e2e suites run the app as it is deployed behind a
# signing-in reverse proxy: PW_AUTH=proxy, and scripts/e2e-proxy.mjs stands in for the proxy (it adds PW_PROXY_SECRET).
# users.mjs and sso.mjs start their own servers with accounts.
# Production takes its own address only from PW_BASE_URL (relative data URLs in server renders and thumbnails): the proxy's.
# The api e2e test receives webhooks on 127.0.0.1, which the SSRF guard blocks unless listed.
SECRET=${PW_PROXY_SECRET:-$(openssl rand -hex 24)}
PW_AUTH=${PW_AUTH:-proxy} PW_PROXY_SECRET=$SECRET PW_BASE_URL=${PW_BASE_URL:-http://localhost:$PORT} PW_API_KEYS=${PW_API_KEYS:-test-key} \
  PW_WEBHOOK_SECRET=${PW_WEBHOOK_SECRET:-testsecret} PW_INTERNAL_HOSTS=${PW_INTERNAL_HOSTS:-localhost,127.0.0.1} PW_EMBED_ORIGINS=${PW_EMBED_ORIGINS:-http://localhost:4000} \
  nohup npx next start -p "$INNER" > /tmp/next.log 2>&1 < /dev/null &
PORT=$PORT INNER=$INNER PW_PROXY_SECRET=$SECRET nohup node scripts/e2e-proxy.mjs > /tmp/e2e-proxy.log 2>&1 < /dev/null &
sleep 5
curl -s -o /dev/null -w "server %{http_code} on :$PORT\n" "localhost:$PORT/"
