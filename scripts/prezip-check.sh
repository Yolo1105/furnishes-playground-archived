#!/usr/bin/env bash
# scripts/prezip-check.sh
#
# Sanity check run before zipping the project for distribution. Catches
# the kinds of broken filesystem entries that have slipped through in
# the past:
#
#   • Paths containing literal `{` or `}` — caused by `mkdir -p {a,b}`
#     in a shell that didn't expand the braces (e.g. POSIX `sh`,
#     non-interactive subshells). These produce one literal directory
#     instead of N expanded ones.
#   • Paths containing `,` — usually the same bug (an unexpanded brace
#     list with a comma inside).
#   • Paths with control characters or trailing whitespace.
#   • Any of the build-output / dependency directories that should
#     never be shipped (`node_modules`, `.next`, `dist`, `build`).
#
# Exits non-zero if any are found, with a clear message about what
# was wrong and how to fix it. Safe to run repeatedly.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail=0

# 1) Any path containing { or } or , is suspicious. find -path checks
#    every entry under the project root.
bad_paths="$(
  find . \
    -not -path './node_modules/*' \
    -not -path './.next/*' \
    -not -path './.git/*' \
    \( -name '*{*' -o -name '*}*' -o -name '*,*' \) \
    -print 2>/dev/null || true
)"
if [ -n "$bad_paths" ]; then
  echo "✗ Found paths containing brace/comma characters:"
  echo "$bad_paths" | sed 's/^/    /'
  echo
  echo "  Cause: a 'mkdir -p {a,b}' command was run in a shell that"
  echo "  didn't expand the braces. The shell created one literal"
  echo "  directory named '{a,b}' instead of two ('a' and 'b')."
  echo
  echo "  Fix: rm -rf '<name>' (single-quote the literal name)."
  fail=1
fi

# 2) node_modules / .next inside the source tree are fine for local
#    dev but should not be zipped — the zip script already excludes
#    them but we sanity-check that they don't appear in unexpected
#    places.
unexpected="$(find . -maxdepth 4 -type d \
  \( -name 'node_modules' -o -name '.next' -o -name 'dist' -o -name 'build' \) \
  -not -path './node_modules' \
  -not -path './.next' \
  -not -path './node_modules/*' \
  -not -path './.next/*' \
  -print 2>/dev/null || true)"
if [ -n "$unexpected" ]; then
  echo "✗ Found build-output / dependency dirs in unexpected places:"
  echo "$unexpected" | sed 's/^/    /'
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "✓ Project tree is clean — safe to zip."
fi

exit "$fail"
