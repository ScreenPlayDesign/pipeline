#!/usr/bin/env bash
# The lane guard for a pull request, as ci.yml runs it in the project checkout.
#
#   lane-guard-pr.sh <head-branch> <base-ref>     e.g. design origin/staging
#
# Lists every path the PR changes since it left <base-ref> and passes them to
# lane-guard.sh, with two rules a plain `git diff` would let slip:
#   --no-renames   a move out of supabase/ lists the old path too, not only the new one
#   base config    [lanes] dev_only is read from <base-ref>'s spd_config.toml, so a
#                  PR cannot drop an entry and change that file in the same PR
# Prints the reason (and, for dev, the migrations it carries); exits as lane-guard.sh does.
set -euo pipefail

if [ $# -ne 2 ] || [ -z "$1" ] || [ -z "$2" ]; then
  echo "usage: lane-guard-pr.sh <head-branch> <base-ref>" >&2
  exit 2
fi
LANE="$1"
BASE="$2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lane-guard.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
# A base without spd_config.toml leaves SPD_CONFIG pointing at no file: only supabase/ is dev-only.
git show "$BASE:spd_config.toml" > "$TMP/spd_config.toml" 2>/dev/null || rm -f "$TMP/spd_config.toml"

FILES=()
while IFS= read -r f; do FILES+=("$f"); done < <(git diff --no-renames --name-only "$BASE"...HEAD)

set +e
SPD_CONFIG="$TMP/spd_config.toml" bash "$HERE/lane-guard.sh" "$LANE" ${FILES[@]+"${FILES[@]}"}
CODE=$?
set -e

if [ "$CODE" -eq 0 ] && [ "$LANE" = dev ]; then
  MIGRATIONS=$(git diff --no-renames --name-only "$BASE"...HEAD -- supabase/migrations/ | tr '\n' ' ' | sed 's/ $//')
  if [ -n "$MIGRATIONS" ]; then
    echo "This dev lane carries schema migrations: $MIGRATIONS"
    echo "No gate report flags them to the dashboard yet: the cornerpost reviews them before this PR merges."
  fi
fi
exit "$CODE"
