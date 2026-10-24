#!/usr/bin/env bash
# Tests for lane-guard.sh. Run: bash scripts/lane-guard.test.sh
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/lane-guard.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lane-guard-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0

# check <expected exit> <config file contents, or '-' for no spd_config.toml> <branch> <files…>
check() {
  local expected="$1" config="$2"
  shift 2
  local dir
  dir="$(mktemp -d "$WORK/case.XXXXXX")"
  if [ "$config" != "-" ]; then
    printf '%s\n' "$config" > "$dir/spd_config.toml"
  fi
  local out code
  out="$(cd "$dir" && bash "$GUARD" "$@" 2>&1)"
  code=$?
  if [ "$code" = "$expected" ] && [ -n "$out" ]; then
    pass=$((pass + 1))
    echo "ok   $* -> $code"
  else
    fail=$((fail + 1))
    echo "FAIL $* -> exit $code, expected $expected; output: ${out:-<none>}"
  fi
}

DB_TS='[lanes]
dev_only = ["src/types/db.ts"]'

MULTI='[project]
name = "x"   # a comment

[lanes]
dev_only = [
  "src/types/db.ts",   # generated from the schema
  '"'"'generated/'"'"',
]

[other]
dev_only = ["src/App.tsx"]'

check 0 -        dev        supabase/migrations/1.sql
check 1 -        design     supabase/functions/x/index.ts
check 0 -        design     src/App.tsx
check 0 -        chore      supabase/migrations/1.sql
check 1 -        feature-x  README.md
check 1 -        proposal-2 src/a.ts
check 1 -        data       src/a.ts
check 1 "$DB_TS" design     src/types/db.ts

# Config edge cases: no file or no [lanes] means only supabase/ is dev-only;
# multi-line arrays, comments, single quotes and directory entries are read;
# a dev_only key in another section is not.
check 0 -                      design src/types/db.ts
check 0 '[project]
name = "x"'                    design src/types/db.ts
check 1 "$MULTI"               design src/App.tsx src/types/db.ts
check 1 "$MULTI"               design generated/x.ts
check 0 "$MULTI"               design src/App.tsx src/types/db.tsx
check 0 "$DB_TS"               dev    src/types/db.ts supabase/config.toml
check 0 "$DB_TS"               design supabase-notes.md

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
