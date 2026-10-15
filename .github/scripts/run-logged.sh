#!/usr/bin/env bash
# Runs a command and, if it fails, copies the last lines of its output into a
# GitHub annotation. Annotations show on the run's summary page (and through
# the checks API), so a failure can be diagnosed without opening raw logs.
#
# Usage: bash .github/scripts/run-logged.sh "<title>" <command> [args...]

title="$1"
shift

log="$(mktemp)"
set -o pipefail
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}

if [ "$code" -ne 0 ]; then
  # Prefer the lines that explain the failure; fall back to the plain tail.
  grep -iE "error|err!|gyp|fail|cannot|not found|msb|\.cc\(|\.cpp\(" "$log" | tail -n 40 > "$log.err"
  [ -s "$log.err" ] || tail -n 40 "$log" > "$log.err"
  msg=$(sed -e 's/%/%25/g' -e 's/\r//g' "$log.err" | awk '{printf "%s%%0A", $0}')
  echo "::error title=${title} failed (exit ${code})::${msg}"
fi

exit "$code"
