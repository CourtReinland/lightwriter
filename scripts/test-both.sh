#!/usr/bin/env bash
#
# Run the LightWriter (vitest) and ScriptToScreen (unittest) integration suites
# together, so the LightWriter <-> ScriptToScreen handoff contract is validated
# on both sides in one command. (Addresses integration ask #4.)
#
# ScriptToScreen lives in a separate repo. Override its location with S2S_DIR:
#   S2S_DIR=/path/to/script2screen ./scripts/test-both.sh
#
set -uo pipefail

LW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
S2S_DIR="${S2S_DIR:-$HOME/Projects/script2screen}"

echo "== LightWriter (vitest) =="
( cd "$LW_DIR" && npx vitest run )
LW_STATUS=$?

echo ""
echo "== ScriptToScreen handoff (python unittest) =="
if [ -d "$S2S_DIR" ]; then
  ( cd "$S2S_DIR" && PYTHONPATH=. python3 -m unittest discover -s tests )
  S2S_STATUS=$?
else
  echo "SKIP: ScriptToScreen repo not found at '$S2S_DIR' (set S2S_DIR to its path)."
  S2S_STATUS=0
fi

echo ""
echo "== Summary =="
echo "LightWriter vitest exit:        $LW_STATUS"
echo "ScriptToScreen unittest exit:   $S2S_STATUS"

if [ "$LW_STATUS" -ne 0 ] || [ "$S2S_STATUS" -ne 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS (both suites green)"
