#!/usr/bin/env bash
# Copy the latest engine from a NotebookTools checkout into src/engine/.
#   scripts/sync-engine.sh /path/to/notebooktools
set -euo pipefail
SRC="${1:?path to the notebooktools repo}/website/tools"
DST="$(cd "$(dirname "$0")/.." && pwd)/src/engine"
for f in pdf-kit.js slide-engine.js; do
  { printf '/* localOCR engine file, copied unchanged from NotebookTools (website/tools/%s).\n   Update with scripts/sync-engine.sh; do not edit here. */\n' "$f"; cat "$SRC/$f"; } > "$DST/$f"
done
echo "engine synced from $SRC"
