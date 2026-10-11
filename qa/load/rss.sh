#!/usr/bin/env bash
# Every 5 s: epoch-seconds and the summed RSS (MB) of the server process (next-server; its render threads are in it) → $1
while true; do echo "$(date +%s) $(ps -eo rss=,args= | grep -E 'next-server|next start' | grep -v grep | awk '{s+=$1} END {print int(s/1024)}')" >> "$1"; sleep 5; done
