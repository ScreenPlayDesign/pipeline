#!/usr/bin/env bash
# The lane guard for a pull request, as ci.yml runs it in the project checkout.
#
#   lane-guard-pr.sh <head-branch> <base-ref>     e.g. design origin/staging, chore origin/prod
#
# Lists every path the PR changes since it left <base-ref> and passes them to
# lane-guard.sh, with two rules a plain `git diff` would let slip:
#   --no-renames   a move out of supabase/ lists the old path too, not only the new one
#   base config    [lanes] dev_only is read from <base-ref>'s spd_config.toml, so a
#                  PR cannot drop an entry and change that file in the same PR
#   release bumps  a lane rebased on a release carries the release's own bump
#                  commit, which staging and prod lack until dev merges. A file
#                  changed only by such commits in <base-ref>..HEAD is left out.
#                  A bump is judged by content, as the Playhouse's rebase.ts
#                  isBump: the subject `docs: release vYYYY.MM.DD.N`, and the
#                  commit changes CHANGELOG.md and/or package.json, the latter
#                  only on its "version" line. Any other commit (a look-alike
#                  subject included) that touches a file keeps it judged.
# The base branch (origin/ stripped) goes to lane-guard.sh as LANE_BASE.
# Prints the reason (and, for dev, the migrations it carries); exits as lane-guard.sh does.
set -euo pipefail

if [ $# -ne 2 ] || [ -z "$1" ] || [ -z "$2" ]; then
  echo "usage: lane-guard-pr.sh <head-branch> <base-ref>" >&2
  exit 2
fi
LANE="$1"
BASE="$2"
export LANE_BASE="${BASE#origin/}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lane-guard.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
# A base without spd_config.toml leaves SPD_CONFIG pointing at no file: only supabase/ is dev-only.
git show "$BASE:spd_config.toml" > "$TMP/spd_config.toml" 2>/dev/null || rm -f "$TMP/spd_config.toml"

BUMP_SUBJECT='^docs: release v[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+$'

# is_bump <sha> <subject>: the release's own CHANGELOG/version bump, by content.
is_bump() {
  local sha="$1" subject="$2" f files=0
  [[ "$subject" =~ $BUMP_SUBJECT ]] || return 1
  [ "$(git rev-list --parents -n 1 "$sha" | wc -w)" -eq 2 ] || return 1   # one parent
  while IFS= read -r f; do
    files=$((files + 1))
    case "$f" in
      CHANGELOG.md) ;;
      package.json)
        # every changed line is the "version" line (the diff read whole, then judged)
        local diff other
        diff="$(git diff --no-renames -U0 "$sha^" "$sha" -- package.json)" || return 1
        other="$(printf '%s\n' "$diff" | grep -E '^[-+]' | grep -vE '^(---|\+\+\+) (a/|b/|/dev/null)' |
          grep -vE '^[-+][[:space:]]*"version"[[:space:]]*:[^,]*,?[[:space:]]*$' || true)"
        [ -z "$other" ] || return 1 ;;
      *) return 1 ;;
    esac
  done < <(git diff --no-renames --name-only "$sha^" "$sha")
  [ "$files" -gt 0 ]
}

# The files some commit other than a release bump changed in BASE..HEAD. A merge counts with
# what it changed against every parent (-c), so a merge's own edits are never left out.
OTHER="$TMP/other"
BUMPED="$TMP/bumped"
: > "$OTHER"
: > "$BUMPED"
while IFS=$'\t' read -r sha subject; do
  if is_bump "$sha" "$subject"; then
    git diff --no-renames --name-only "$sha^" "$sha" >> "$BUMPED"
  else
    git log -1 -c --no-renames --name-only --format= "$sha" >> "$OTHER"
  fi
done < <(git log --no-merges --format='%H%x09%s' "$BASE"..HEAD)
while IFS= read -r sha; do
  git log -1 -c --no-renames --name-only --format= "$sha" >> "$OTHER"
done < <(git rev-list --merges "$BASE"..HEAD)

FILES=()
while IFS= read -r f; do
  if grep -qxF -- "$f" "$BUMPED" && ! grep -qxF -- "$f" "$OTHER"; then continue; fi
  FILES+=("$f")
done < <(git diff --no-renames --name-only "$BASE"...HEAD)

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
