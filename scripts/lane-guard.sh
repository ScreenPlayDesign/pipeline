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
#     design  may change only paths under design/, and the scenes' Linux baselines
#             (screenplay/…-snapshots/…-linux.png), which Approve screenshots pushes there
#             for the designer to approve (Jon, 2026-11-07)
#     chore  may change anything but supabase/, a dev-only path or design/
#     any other head branch (proposal-N, data, feature-x …) never PRs into
#     staging, whatever it changes; proposals land on dev or design
#   base prod
#     staging may bring anything
#     chore   the same limits as into staging (Jon, 2026-10-29: chore goes into staging or prod)
#     any other head branch never PRs into prod
#
# A kit project is one whose PR checkout holds frontend/src/design/manifest.json (looked for under
# LANE_ROOT, default the current directory: the PR's checkout) or whose changed files include it,
# so a PR that touches the manifest is judged by the kit rules. Its design lives in the
# design repo and arrives through the design kit, so it has no design/ folder and its rules differ
# (every other project keeps the rules above, unchanged):
#   every lane  (dev, design, chore) refuses a path under design/: a kit project has no design/
#   the kit's app files   frontend/src/design/, the public root files (logo.svg, favicon.ico,
#     robots.txt …) and frontend/public/{icons,img,brand,fonts}/, as listed in design-owned.txt
#     beside this script, a copy of `design-kit owned app` (lane-guard.test.sh compares them)
#   dev, chore  may not change a kit file: it goes through the design lane
#   design      may change only a kit file and the scenes' Linux baselines
#   base prod   staging brings anything; chore has the same limits as into staging
# The other limits (supabase/, dev-only paths, migrations) stay as they are.
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

# A kit project: frontend/src/design/manifest.json exists in the PR's checkout, or is one of the
# changed files. The second test closes a bypass: a PR that deletes the manifest has no manifest in its
# checkout, so without it the same PR could also change a kit file. A PR that touches the manifest is
# judged by the kit rules.
KIT_ROOT="${LANE_ROOT:-.}"
IS_KIT=0
if [ -f "$KIT_ROOT/frontend/src/design/manifest.json" ]; then IS_KIT=1; fi
for f in "$@"; do
  if [ "$f" = frontend/src/design/manifest.json ]; then IS_KIT=1; fi
done

# True when the file is one the design kit owns, by design-owned.txt (a copy of `design-kit owned app`):
# a line ending in / is a folder prefix, any other line is a file; # starts a comment. A kit project
# with no list cannot be judged, so the guard refuses rather than let a kit file through.
OWNED_LIST="$HERE/design-owned.txt"
is_kit_owned() {
  local file="$1" entry
  if [ ! -f "$OWNED_LIST" ]; then
    echo "Cannot read design-owned.txt next to the lane guard: the design kit's files are unknown."
    echo "Restore scripts/design-owned.txt in the pipeline (bun design-kit/src/cli.ts owned app > scripts/design-owned.txt)."
    exit 1
  fi
  while IFS= read -r entry || [ -n "$entry" ]; do
    entry="${entry%$'\r'}"   # a CRLF list must still match
    case "$entry" in ''|'#'*) continue ;; esac
    case "$entry" in
      */) case "$file" in "$entry"*) return 0 ;; esac ;;
      *)  if [ "$file" = "$entry" ]; then return 0; fi ;;
    esac
  done < "$OWNED_LIST"
  return 1
}

# Prints why a kit project's lane may not change these design/ paths, and the kit files for the
# lanes that may not change those either; exits 1 when it printed anything. Call as
# refuse_kit <lane> <check kit files: yes|no> <files…>. Does nothing outside a kit project.
refuse_kit() {
  local lane="$1" kit_files="$2" f no_design="" owned=""
  shift 2
  [ "$IS_KIT" -eq 1 ] || return 0
  for f in "$@"; do
    case "$f" in design/*) no_design="$no_design $f"; continue ;; esac
    if [ "$kit_files" = yes ] && is_kit_owned "$f"; then owned="$owned $f"; fi
  done
  if [ -n "$no_design" ]; then
    echo "A kit project keeps its design in the design repo and has no design/ folder."
    echo "Offending files:$no_design"
    echo "Move the change to the design repo, or drop these paths from the $lane lane."
  fi
  if [ -n "$owned" ]; then
    echo "The $lane lane may not change the design kit's files: they go through the design lane."
    echo "Offending files:$owned"
    echo "Move those changes to a design lane pull request."
  fi
  if [ -n "$no_design$owned" ]; then exit 1; fi
  return 0
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

# The chore lane, into staging or prod: anything but supabase/, a dev-only path or design/.
guard_chore() {
  local f offending=""
  if [ "$IS_KIT" -eq 1 ]; then
    # In a kit project design/ is not a path at all, and the kit's files are the design lane's.
    local kit_out
    kit_out="$(refuse_kit chore yes "$@")" || { printf '%s\n' "$kit_out"; exit 1; }
    for f in "$@"; do
      if is_dev_only "$f"; then offending="$offending $f"; fi
    done
    if [ -n "$offending" ]; then
      echo "The chore lane may not change supabase/ or a dev-only path."
      echo "Offending files:$offending"
      exit 1
    fi
    echo "The chore lane changes no supabase/, dev-only or design kit path."
    refuse_misplaced "$@"
    exit 0
  fi
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
  exit 0
}

case "$BASE" in
  staging)
    case "$LANE" in
      dev)
        if [ "$IS_KIT" -eq 1 ]; then
          refuse_kit dev yes "$@"
          echo "The dev lane changes no design kit file and no design/ path."
          refuse_misplaced "$@"
          exit 0
        fi
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
        if [ "$IS_KIT" -eq 1 ]; then
          refuse_kit design no "$@"
          offending=""
          for f in "$@"; do
            case "$f" in screenplay/*-snapshots/*-linux.png) continue ;; esac
            if ! is_kit_owned "$f"; then offending="$offending $f"; fi
          done
          if [ -n "$offending" ]; then
            echo "The design lane of a kit project may change only the design kit's files and the scenes' Linux baselines."
            echo "Offending files:$offending"
            echo "The kit's files are listed in design-owned.txt next to the lane guard; anything else is the dev lane's."
            exit 1
          fi
          echo "The design lane changes only the design kit's files and the scenes' Linux baselines."
          refuse_misplaced "$@"
          exit 0
        fi
        offending=""
        for f in "$@"; do
          case "$f" in
            design/*|screenplay/*-snapshots/*-linux.png) ;;
            *) offending="$offending $f" ;;
          esac
        done
        if [ -n "$offending" ]; then
          echo "The design lane may change only design/ and the scenes' Linux baselines."
          echo "Offending files:$offending"
          exit 1
        fi
        echo "The design lane changes only design/ and the scenes' Linux baselines."
        refuse_misplaced "$@"
        exit 0 ;;
      chore)
        guard_chore "$@" ;;
      proposal-*)
        echo "'$LANE' is a proposal lane: it lands on dev or design by a reviewed pull request, never on staging."
        exit 1 ;;
      *)
        echo "'$LANE' is not a lane. Only dev, design and chore open pull requests into staging."
        exit 1 ;;
    esac ;;
  prod)
    case "$LANE" in
      staging)
        echo "Staging may bring anything into prod."
        refuse_misplaced "$@"
        exit 0 ;;
      chore)
        guard_chore "$@" ;;
      *)
        echo "'$LANE' may not open a pull request into prod. Only staging and chore open pull requests into prod."
        exit 1 ;;
    esac ;;
  *)
    echo "'$BASE' is not a lane base. Pull requests go into staging or prod."
    exit 1 ;;
esac
