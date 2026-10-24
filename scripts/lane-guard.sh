#!/usr/bin/env bash
# Lane guard for a pull request into staging.
#
#   lane-guard.sh <head-branch> <changed-files…>
#
# Exits 0 when the lane may bring these files to staging, 1 when it may not,
# and prints the reason either way. Rules (the lanes model, 2026-10-22):
#   dev     may change anything, supabase/ included
#   design  may not change supabase/ or any dev-only path
#   chore   may change anything
#   any other head branch (proposal-N, data, feature-x …) never PRs into
#   staging, whatever it changes; proposals land on dev or design
#
# Dev-only paths are supabase/ plus the `[lanes] dev_only = [...]` list in the
# project's spd_config.toml (SPD_CONFIG, default ./spd_config.toml), e.g. the
# generated src/types/db.ts. An entry ending in / covers that directory; any
# other entry covers that file, or that directory when it is one. No file, no
# [lanes] section or no dev_only key means only supabase/ is dev-only.
set -euo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: lane-guard.sh <head-branch> <changed-files…>" >&2
  exit 2
fi
LANE="$1"
shift

# Prints the dev_only entries of [lanes], one per line. Reads a one-line or
# multi-line string array; # comments outside quotes are ignored.
dev_only_entries() {
  local config="${SPD_CONFIG:-spd_config.toml}"
  [ -f "$config" ] || return 0
  awk '
    # The line up to the first # outside a quoted string.
    function uncomment(s,   i, c, q, out) {
      q = ""; out = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (q == "" && c == "#") break
        if (q == "" && (c == "\"" || c == "\047")) q = c
        else if (q != "" && c == q) q = ""
        out = out c
      }
      return out
    }
    # True when s holds a ] outside a quoted string.
    function closes(s,   i, c, q) {
      q = ""
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (q == "" && c == "]") return 1
        if (q == "" && (c == "\"" || c == "\047")) q = c
        else if (q != "" && c == q) q = ""
      }
      return 0
    }
    function emit(s) {
      while (match(s, /"[^"]*"|\047[^\047]*\047/)) {
        print substr(s, RSTART + 1, RLENGTH - 2)
        s = substr(s, RSTART + RLENGTH)
      }
    }
    { line = uncomment($0) }
    collecting {
      buf = buf " " line
      if (closes(line)) { emit(buf); collecting = 0 }
      next
    }
    line ~ /^[ \t]*\[/ { in_lanes = (line ~ /^[ \t]*\[[ \t]*lanes[ \t]*\][ \t]*$/); next }
    in_lanes && line ~ /^[ \t]*dev_only[ \t]*=/ {
      buf = line
      sub(/^[^=]*=/, "", buf)
      if (closes(buf)) emit(buf); else collecting = 1
    }
  ' "$config"
}

# True when the file is under supabase/ or a dev-only entry.
is_dev_only() {
  local file="$1" entry
  case "$file" in supabase/*) return 0 ;; esac
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in
      */) case "$file" in "$entry"*) return 0 ;; esac ;;
      *)  if [ "$file" = "$entry" ]; then return 0; fi
          case "$file" in "$entry"/*) return 0 ;; esac ;;
    esac
  done <<EOF
$(dev_only_entries)
EOF
  return 1
}

case "$LANE" in
  dev)
    echo "The dev lane may change anything, supabase/ included."
    exit 0 ;;
  chore)
    echo "The chore lane may change anything."
    exit 0 ;;
  design)
    offending=""
    for f in "$@"; do
      if is_dev_only "$f"; then offending="$offending $f"; fi
    done
    if [ -n "$offending" ]; then
      echo "The design lane may not change supabase/ or a dev-only path; that work rides the dev lane."
      echo "Offending files:$offending"
      exit 1
    fi
    echo "The design lane changes no dev-only path."
    exit 0 ;;
  proposal-*)
    echo "'$LANE' is a proposal lane: it lands on dev or design by a reviewed pull request, never on staging."
    exit 1 ;;
  *)
    echo "'$LANE' is not a lane. Only dev, design and chore open pull requests into staging."
    exit 1 ;;
esac
