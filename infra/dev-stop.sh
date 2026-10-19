#!/bin/sh
# Hentikan proses dev (API, worker, web) yang dijalankan dari repo ini.
for p in "tsx --watch src/main.ts" "tsx --watch src/worker.ts" "next dev -p 3001" "next dev -p 3002"; do
  pgrep -f "$p" | while read pid; do [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill "$pid"; done 2>/dev/null || true
done
echo "proses dev dihentikan"
