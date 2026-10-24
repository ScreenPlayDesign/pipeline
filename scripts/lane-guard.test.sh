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

# ── lane-guard-pr.sh: the PR's own diff, against a real git history ─────────
PR_GUARD="$HERE/lane-guard-pr.sh"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# new_repo <with config: yes|no> → prints the repo path; branch staging holds the base.
new_repo() {
  local repo
  repo="$(mktemp -d "$WORK/repo.XXXXXX")"
  (
    cd "$repo"
    git init -q
    git checkout -q -b staging
    mkdir -p supabase/migrations src/types
    printf 'create table t (id int primary key, name text not null, created_at timestamptz);\n' > supabase/migrations/001_init.sql
    printf 'export type Db = { t: { id: number; name: string } }\n' > src/types/db.ts
    printf 'export const App = () => null\n' > src/App.tsx
    if [ "$1" = yes ]; then printf '%s\n' "$DB_TS" > spd_config.toml; fi
    git add -A && git commit -qm base
  )
  echo "$repo"
}

# check_pr <expected exit> <expected text or ''> <repo> <lane> <commands that make the lane's commit>
check_pr() {
  local expected="$1" want="$2" repo="$3" lane="$4" change="$5"
  local out code
  (cd "$repo" && git checkout -q -B "$lane" staging && eval "$change" && git add -A && git commit -qm change) >/dev/null
  out="$(cd "$repo" && bash "$PR_GUARD" "$lane" staging 2>&1)"
  code=$?
  if [ "$code" = "$expected" ] && [ -n "$out" ] && { [ -z "$want" ] || printf '%s' "$out" | grep -qF "$want"; }; then
    pass=$((pass + 1))
    echo "ok   pr $lane: $change -> $code"
  else
    fail=$((fail + 1))
    echo "FAIL pr $lane: $change -> exit $code, expected $expected${want:+ and \"$want\"}; output: ${out:-<none>}"
  fi
}

R="$(new_repo yes)"
# A move out of supabase/ still changes supabase/ (rename detection would list only docs/).
check_pr 1 'supabase/migrations/001_init.sql' "$R" design 'mkdir -p docs && git mv supabase/migrations/001_init.sql docs/001_init.sql'
check_pr 1 'src/types/db.ts' "$R" design 'git mv src/types/db.ts src/types/schema.ts'
# The dev_only list is the base's: dropping the entry in the same PR does not free the file.
check_pr 1 'src/types/db.ts' "$R" design 'printf "[lanes]\ndev_only = []\n" > spd_config.toml && echo "// x" >> src/types/db.ts'
check_pr 0 '' "$R" design 'echo "// x" >> src/App.tsx'
check_pr 0 'carries schema migrations: supabase/migrations/002_more.sql' "$R" dev 'echo "select 1;" > supabase/migrations/002_more.sql'
check_pr 1 '' "$R" proposal-3 'echo "// x" >> src/App.tsx'
# A base without spd_config.toml: only supabase/ is dev-only, whatever the head's config says.
R2="$(new_repo no)"
check_pr 0 '' "$R2" design 'printf "%s\n" "$DB_TS" > spd_config.toml && echo "// x" >> src/types/db.ts'

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
