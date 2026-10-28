#!/usr/bin/env bash
# Lane guard for a pull request into staging or prod.
#
#   lane-guard.sh <head-branch> <changed-files…>
#
# The base branch comes from LANE_BASE (staging or prod; default staging).
# Exits 0 when the lane may bring these files to that base, 1 when it may not,
# and prints the reason either way. Rules:
#   base staging
#     dev     may change anything but design/, supabase/ included
#     design  may change only paths under design/
#     chore   never goes to staging: it goes straight into prod
#     any other head branch (proposal-N, data, feature-x …) never PRs into
#     staging, whatever it changes; proposals land on dev or design
#   base prod
#     staging may bring anything
#     chore   may change anything but supabase/, a dev-only path or design/
#     any other head branch never PRs into prod
#
# On every lane and base, a migration lives only in supabase/migrations/ (Jon, 2026-10-28): a .sql
# file in any other migrations/ folder, or one named like a migration (it starts with a digit)
# anywhere but supabase/migrations/ and supabase/tests/, fails the guard.
#
# Dev-only paths are supabase/ plus the `[lanes] dev_only = [...]` list in the
# project's spd_config.toml (SPD_CONFIG, default ./spd_config.toml), read by
# spd-config.ts, e.g. the generated frontend/src/types/db.ts. An entry ending in / covers that directory; any
# other entry covers that file, or that directory when it is one. No file, no
# [lanes] section or no dev_only key means only supabase/ is dev-only; a file spd-config.ts
# cannot read refuses the lane.
set -euo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: lane-guard.sh <head-branch> <changed-files…>" >&2
  exit 2
fi
LANE="$1"
BASE="${LANE_BASE:-staging}"
shift

# The dev_only entries of [lanes], read once by spd-config.ts (the pipeline's hash-checked copy of the
# client's schema, the one reader of spd_config.toml). The reader runs from the pipeline's own folder,
# so a project's bunfig.toml or .env never loads. Exit 1 with "is not set in" means the key is absent:
# no entries. Any other failure means the guard cannot know the dev-only paths, so it refuses (exit 1)
# and says why, rather than guess that only supabase/ is dev-only.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_ONLY_LOADED=0
DEV_ONLY=""
load_dev_only() {
  DEV_ONLY_LOADED=1
  local config="${SPD_CONFIG:-spd_config.toml}" out
  [ -f "$config" ] || return 0
  config="$(cd "$(dirname "$config")" && pwd)/$(basename "$config")"
  if ! command -v bun >/dev/null 2>&1; then
    echo "Cannot read spd_config.toml (the guard needs bun): the dev-only paths are unknown."
    exit 1
  fi
  if out="$(cd "$HERE" && bun --no-env-file spd-config.ts get lanes.dev_only --file "$config" 2>&1)"; then
    DEV_ONLY="$out"
  else
    case "$out" in
      *"is not set in"*) ;;
      *) echo "Cannot read spd_config.toml: the dev-only paths are unknown."
         printf '%s\n' "$out" | sed 's/^/  /'
         exit 1 ;;
    esac
  fi
  return 0
}

# True when the file is under supabase/ or a dev-only entry.
is_dev_only() {
  local file="$1" entry
  case "$file" in supabase/*) return 0 ;; esac
  [ "$DEV_ONLY_LOADED" -eq 1 ] || load_dev_only
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in
      */) case "$file" in "$entry"*) return 0 ;; esac ;;
      *)  if [ "$file" = "$entry" ]; then return 0; fi
          case "$file" in "$entry"/*) return 0 ;; esac ;;
    esac
  done <<EOF
$DEV_ONLY
EOF
  return 1
}

# A migration outside supabase/migrations/ is refused on every lane, whatever the base: checked where a
# lane would otherwise pass, so a lane's own refusal speaks first.
refuse_misplaced() {
  local f misplaced=""
  for f in "$@"; do
    case "$f" in
      supabase/migrations/*|supabase/tests/*) continue ;;
      *.sql) ;;
      *) continue ;;
    esac
    case "/$f" in
      */migrations/*) misplaced="$misplaced $f"; continue ;;
    esac
    case "$(basename "$f")" in [0-9]*) misplaced="$misplaced $f" ;; esac
  done
  if [ -n "$misplaced" ]; then
    echo "A migration lives only in supabase/migrations/."
    echo "Misplaced files:$misplaced"
    exit 1
  fi
}

case "$BASE" in
  staging)
    case "$LANE" in
      dev)
        offending=""
        for f in "$@"; do
          case "$f" in design/*) offending="$offending $f" ;; esac
        done
        if [ -n "$offending" ]; then
          echo "The dev lane may change anything but design/."
          echo "Offending files:$offending"
          exit 1
        fi
        echo "The dev lane changes nothing under design/."
        refuse_misplaced "$@"
        exit 0 ;;
      design)
        offending=""
        for f in "$@"; do
          case "$f" in design/*) ;; *) offending="$offending $f" ;; esac
        done
        if [ -n "$offending" ]; then
          echo "The design lane may change only design/."
          echo "Offending files:$offending"
          exit 1
        fi
        echo "The design lane changes only design/."
        refuse_misplaced "$@"
        exit 0 ;;
      chore)
        echo "The chore lane does not open pull requests into staging: chore goes straight into prod."
        exit 1 ;;
      proposal-*)
        echo "'$LANE' is a proposal lane: it lands on dev or design by a reviewed pull request, never on staging."
        exit 1 ;;
      *)
        echo "'$LANE' is not a lane. Only dev and design open pull requests into staging."
        exit 1 ;;
    esac ;;
  prod)
    case "$LANE" in
      staging)
        echo "Staging may bring anything into prod."
        refuse_misplaced "$@"
        exit 0 ;;
      chore)
        offending=""
        for f in "$@"; do
          case "$f" in design/*) offending="$offending $f"; continue ;; esac
          if is_dev_only "$f"; then offending="$offending $f"; fi
        done
        if [ -n "$offending" ]; then
          echo "The chore lane may not change supabase/, a dev-only path or design/."
          echo "Offending files:$offending"
          exit 1
        fi
        echo "The chore lane changes no supabase/, dev-only or design/ path."
        refuse_misplaced "$@"
        exit 0 ;;
      *)
        echo "'$LANE' may not open a pull request into prod. Only staging and chore open pull requests into prod."
        exit 1 ;;
    esac ;;
  *)
    echo "'$BASE' is not a lane base. Pull requests go into staging or prod."
    exit 1 ;;
esac
