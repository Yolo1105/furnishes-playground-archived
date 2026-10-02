#!/usr/bin/env bash
# scripts/zip-build.sh
#
# Canonical zip-the-project command. Runs the prezip-check first; if
# the tree is clean, produces a zip at the path passed as the first
# argument (defaults to a sibling location).
#
# Usage:
#   ./scripts/zip-build.sh [output-path]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Run sanity check — if it fails, don't zip.
bash "$ROOT/scripts/prezip-check.sh"

OUTPUT_PATH="${1:-/mnt/user-data/outputs/furnishes-studio.zip}"

# Make sure the destination directory exists.
mkdir -p "$(dirname "$OUTPUT_PATH")"
rm -f "$OUTPUT_PATH"

# Zip the project, excluding build/dependency dirs. We zip from the
# parent directory so the archive root is `furnishes-studio/...`,
# which is what users expect when they extract.
PARENT="$(dirname "$ROOT")"
NAME="$(basename "$ROOT")"
cd "$PARENT"
zip -rq "$OUTPUT_PATH" "$NAME" \
  -x "$NAME/node_modules/*" \
  -x "$NAME/.next/*" \
  -x "$NAME/.git/*"

echo "✓ Wrote $OUTPUT_PATH ($(du -h "$OUTPUT_PATH" | cut -f1))"
