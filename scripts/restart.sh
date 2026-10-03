#!/bin/sh
# Rebuild and restart the production server on :3000 (dev helper).
for pid in $(ps -eo pid,comm | awk '$2=="next-server"{print $1}'); do kill "$pid"; done
sleep 1
PW_EMBED_ORIGINS=${PW_EMBED_ORIGINS:-http://localhost:4000} timeout 400 npm run build > /tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }
PW_API_KEYS=${PW_API_KEYS:-test-key} PW_WEBHOOK_SECRET=${PW_WEBHOOK_SECRET:-testsecret} setsid nohup npx next start -p 3000 > /tmp/next.log 2>&1 < /dev/null &
sleep 5
curl -s -o /dev/null -w "server %{http_code}\n" localhost:3000/
