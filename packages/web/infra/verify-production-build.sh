#!/usr/bin/env bash
set -euo pipefail

DIST_INDEX="packages/web/dist/index.html"

if [[ ! -f "$DIST_INDEX" ]]; then
  echo "ERROR: file non trovato: $DIST_INDEX"
  exit 1
fi

if rg -q 'src/index\.(tsx|css)' "$DIST_INDEX"; then
  echo "ERROR: index.html punta ancora a src/index.tsx o src/index.css"
  exit 1
fi

if ! rg -q 'index-[A-Za-z0-9_-]+\.js' "$DIST_INDEX"; then
  echo "ERROR: bundle JS hashed non trovato in index.html"
  exit 1
fi

if ! rg -q 'index-[A-Za-z0-9_-]+\.css' "$DIST_INDEX"; then
  echo "ERROR: bundle CSS hashed non trovato in index.html"
  exit 1
fi

echo "OK: index.html usa asset hashed della build di produzione"
