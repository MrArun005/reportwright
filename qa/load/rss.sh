#!/usr/bin/env bash
# Every 5 s: epoch-seconds and the summed RSS (MB) of every node process (the server and its render threads) → $1
while true; do echo "$(date +%s) $(ps -C node -o rss= | awk '{s+=$1} END {print int(s/1024)}')" >> "$1"; sleep 5; done
