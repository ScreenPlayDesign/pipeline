#!/usr/bin/env bash
# Tests for lane-guard.sh. Run: bash scripts/lane-guard.test.sh
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/lane-guard.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lane-guard-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0

# checkb <expected exit> <config or '-'> <base> <branch> <files…>: check with LANE_BASE set
checkb() {
  local expected="$1" config="$2" base="$3"
  shift 3
  LANE_BASE="$base" check "$expected" "$config" "$@"
}

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
check 1 -        design     src/App.tsx                 # design changes only design/
check 0 -        design     design/guidebook.toml
check 1 -        chore      README.md                   # chore no longer goes to staging
checkb 0 - prod  chore      README.md package.json
checkb 1 - prod  chore      supabase/migrations/1.sql
checkb 1 - prod  chore      design/logo.svg
checkb 1 "$DB_TS" prod chore src/types/db.ts
checkb 0 - prod  staging    supabase/migrations/1.sql
checkb 1 - prod  dev        src/a.ts
checkb 1 - prod  design     design/guidebook.toml
checkb 1 - release dev      src/a.ts                    # an unknown base is refused
check 1 -        feature-x  README.md
check 1 -        proposal-2 src/a.ts
check 1 -        data       src/a.ts
check 1 "$DB_TS" design     src/types/db.ts

# Config edge cases: no file or no [lanes] means only supabase/ is dev-only;
# multi-line arrays, comments, single quotes and directory entries are read;
# a dev_only key in another section is not.
check 1 -                      design src/types/db.ts
check 1 '[project]
name = "x"'                    design src/types/db.ts
check 1 "$MULTI"               design design/a.md src/types/db.ts
check 1 "$MULTI"               design generated/x.ts
check 0 "$MULTI"               design design/a.md design/b.tsx
check 0 "$DB_TS"               dev    src/types/db.ts supabase/config.toml
check 0 "$DB_TS"               design design/supabase-notes.md

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
    mkdir -p design && printf '# a\n' > design/a.md
    if [ "$1" = yes ]; then printf '%s\n' "$DB_TS" > spd_config.toml; fi
    git add -A && git commit -qm base
  )
  echo "$repo"
}

# check_pr <expected exit> <expected text or ''> <repo> <lane> <commands that make the lane's commit>
check_pr() {
  local expected="$1" want="$2" repo="$3" lane="$4" change="$5"
  local out code
  (cd "$repo" && git checkout -q -B "$lane" "${PR_BASE:-staging}" && eval "$change" && git add -A && git commit -qm change) >/dev/null
  out="$(cd "$repo" && bash "$PR_GUARD" "$lane" "${PR_BASE:-staging}" 2>&1)"
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
check_pr 1 '' "$R" design 'echo "// x" >> src/App.tsx'
check_pr 0 '' "$R" design 'mkdir -p design && echo x > design/guidebook.md'
check_pr 1 '' "$R" chore 'echo x >> README.md'
check_pr 0 'carries schema migrations: supabase/migrations/002_more.sql' "$R" dev 'echo "select 1;" > supabase/migrations/002_more.sql'
check_pr 1 '' "$R" proposal-3 'echo "// x" >> src/App.tsx'
# A base without spd_config.toml: only supabase/ is dev-only, whatever the head's config says.
R2="$(new_repo no)"
(cd "$R2" && git checkout -q -B prod staging)
PR_BASE=prod check_pr 0 '' "$R2" chore 'printf "%s\n" "$DB_TS" > spd_config.toml && echo "// x" >> src/types/db.ts'

# A prod base: chore goes straight in, but never touches supabase/.
(cd "$R" && git checkout -q -B prod staging)
PR_BASE=prod check_pr 0 '' "$R" chore 'echo x >> README.md'
PR_BASE=prod check_pr 1 'supabase/' "$R" chore 'echo "select 2;" > supabase/migrations/003.sql'
PR_BASE=prod check_pr 1 'src/types/db.ts' "$R" chore 'echo "// x" >> src/types/db.ts'
PR_BASE=prod check_pr 1 'supabase/migrations/001_init.sql' "$R" chore 'mkdir -p docs && git mv supabase/migrations/001_init.sql docs/x.sql'
PR_BASE=prod check_pr 1 'supabase/migrations/001_init.sql' "$R" chore 'git rm -q supabase/migrations/001_init.sql'
PR_BASE=prod check_pr 1 'src/types/db.ts' "$R" chore 'printf "[lanes]\ndev_only = []\n" > spd_config.toml && echo "// x" >> src/types/db.ts'
PR_BASE=prod check_pr 1 'design/a.md' "$R" chore 'mkdir -p docs && git mv design/a.md docs/a.md'
PR_BASE=prod check_pr 1 'Only staging and chore' "$R" design 'mkdir -p design && echo y > design/a.md'


# ── A lane rebased on a release carries the release's bump commit, which staging lacks ──
# check_rel <expected exit> <expected text or ''> <repo> <lane> <subject> <commands>: the lane is
# release plus one commit with that subject.
check_rel() {
  local expected="$1" want="$2" repo="$3" lane="$4" subject="$5" change="$6"
  local out code
  (cd "$repo" && git checkout -q -B "$lane" release && eval "$change" && git add -A && git commit -qm "$subject") >/dev/null
  out="$(cd "$repo" && bash "$PR_GUARD" "$lane" staging 2>&1)"
  code=$?
  if [ "$code" = "$expected" ] && [ -n "$out" ] && { [ -z "$want" ] || printf '%s' "$out" | grep -qF "$want"; }; then
    pass=$((pass + 1))
    echo "ok   rel $lane: $subject: $change -> $code"
  else
    fail=$((fail + 1))
    echo "FAIL rel $lane: $subject: $change -> exit $code, expected $expected${want:+ and \"$want\"}; output: ${out:-<none>}"
  fi
}

# new_release_repo <bump subject> <bump commands> → staging, and release = staging + that bump.
new_release_repo() {
  local repo
  repo="$(new_repo yes)"
  (
    cd "$repo"
    printf '{\n  "name": "x",\n  "version": "2026.10.24.1",\n  "private": true\n}\n' > package.json
    printf '# Changelog\n' > CHANGELOG.md
    git add -A && git commit -qm 'package'
    git checkout -q -b release
    eval "$2"
    git add -A && git commit -qm "$1"
    git checkout -q staging
  ) >/dev/null
  echo "$repo"
}
BUMP='printf "# Changelog\n\n## v2026.10.25.1\n" > CHANGELOG.md && sed -i.bak "s/2026.10.24.1/2026.10.25.1/" package.json && rm package.json.bak'
R3="$(new_release_repo 'docs: release v2026.10.25.1' "$BUMP")"
check_rel 0 '' "$R3" design 'Design: a new colour' 'echo x > design/colour.md'
check_rel 1 'CHANGELOG.md' "$R3" design 'Design: a note' 'echo x > design/note.md && echo "- a design note" >> CHANGELOG.md'
check_rel 1 'package.json' "$R3" design 'Design: a script' 'echo x > design/note.md && sed -i.bak "s/\"private\": true/\"private\": false/" package.json && rm package.json.bak'
check_rel 0 '' "$R3" dev 'Dev: a fix' 'echo "// y" >> src/App.tsx'
# A look-alike: the bump's subject on a commit that changes other files too.
R4="$(new_release_repo 'docs: release v2026.10.25.1' "$BUMP"' && echo "// z" >> src/App.tsx')"
check_rel 1 'CHANGELOG.md' "$R4" design 'Design: a new colour' 'echo x > design/colour.md'
# A look-alike: the bump's subject, but package.json changes more than its version.
R5="$(new_release_repo 'docs: release v2026.10.25.1' "$BUMP"' && sed -i.bak "s/\"private\": true/\"private\": false/" package.json && rm package.json.bak')"
check_rel 1 'package.json' "$R5" design 'Design: a new colour' 'echo x > design/colour.md'
# Not a bump's subject: the same files are judged.
R6="$(new_release_repo 'docs: release notes' "$BUMP")"
check_rel 1 'CHANGELOG.md' "$R6" design 'Design: a new colour' 'echo x > design/colour.md'

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
