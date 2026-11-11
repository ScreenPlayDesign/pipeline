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
  if [ -n "${KIT:-}" ]; then   # KIT=1 check …: the case is a kit project
    mkdir -p "$dir/frontend/src/design" && printf '{}\n' > "$dir/frontend/src/design/manifest.json"
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

DB_TS='[app]
name = "x"

[lanes]
dev_only = ["src/types/db.ts"]'

MULTI='[app]
name = "x"   # a comment

[lanes]
dev_only = [
  "src/types/db.ts",   # generated from the schema
  '"'"'generated/'"'"',
]

[other]
dev_only = ["src/App.tsx"]'

check 0 -        dev        supabase/migrations/1.sql
check 1 -        dev        design/guidebook.toml       # the dev lane may change anything but design/
check 1 -        dev        src/a.ts design/logo.svg
check 1 -        design     supabase/functions/x/index.ts
check 1 -        design     src/App.tsx                 # design changes only design/
check 0 -        design     design/guidebook.toml
# The scenes' Linux baselines ride the design lane too (Approve screenshots pushes them there).
check 0 -        design     screenplay/tests/arrival.spec.ts-snapshots/landing-linux.png
check 0 -        design     design/logo.svg screenplay/tests/a.spec.ts-snapshots/a-linux.png
check 1 -        design     screenplay/tests/arrival.spec.ts                         # the scene itself is dev's
check 1 -        design     screenplay/tests/arrival.spec.ts-snapshots/landing-darwin.png  # CI reads only Linux
check 1 -        design     screenplay/tests/landing-linux.png                       # not in a snapshots folder
check 1 -        design     frontend/tests/a.spec.ts-snapshots/a-linux.png           # not under screenplay/
check 0 -        chore      README.md package.json      # chore goes to staging as well as prod
check 1 -        chore      supabase/migrations/1.sql   # with the limits it has into prod
check 1 -        chore      design/logo.svg
check 1 "$DB_TS" chore      src/types/db.ts
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

# The guard reads dev_only through spd-config.ts, the one reader of spd_config.toml: a version 2
# file in a spelling the old awk could not follow (a dotted key at the top) still lists its entries,
# and a file the reader refuses refuses the lane, saying why.
V2='schema = 2

[app]
name        = "x"
description = "A site"
kind        = "local"
shape       = "app"

[lanes]
dev_only = ["src/types/db.ts"]'
V2_DOTTED='schema = 2
lanes.dev_only = ["src/types/db.ts"]

[app]
name        = "x"
description = "A site"
kind        = "local"
shape       = "app"'
check 1 "$V2"                  design src/types/db.ts
check 0 "$V2"                  dev    src/types/db.ts
checkb 1 "$V2_DOTTED" prod chore src/types/db.ts      # the lane guard reads dev_only through spd-config.ts
checkb 0 "$V2_DOTTED" prod chore README.md
checkb 1 "$V2" prod chore supabase/migrations/1.sql
check_says() {   # check_says <config> <text the guard prints> <branch> <files…>
  local config="$1" want="$2" dir out code
  shift 2
  dir="$(mktemp -d "$WORK/case.XXXXXX")"
  printf '%s\n' "$config" > "$dir/spd_config.toml"
  out="$(cd "$dir" && bash "$GUARD" "$@" 2>&1)"
  code=$?
  if [ "$code" = 1 ] && printf '%s' "$out" | grep -qF "$want"; then pass=$((pass + 1)); echo "ok   says '$want'"
  else fail=$((fail + 1)); echo "FAIL expected \"$want\"; output: ${out:-<none>}"; fi
}
LANE_BASE=prod check_says 'schema = 3
[lanes]
dev_only = "src/types/db.ts"' 'Cannot read spd_config.toml' chore src/a.ts     # dev_only must be a list
LANE_BASE=prod check_says 'schema = 3
[app]
name = "x"' 'unknown section [app]' chore src/a.ts                             # a hub section in version 3
LANE_BASE=prod check_says 'schema = 4' 'Cannot read spd_config.toml' chore src/a.ts

# Version 3 (code-only facts): the guard reads [lanes] dev_only the same way; a version 2 file
# with only a schema line has no dev-only entries.
V3='schema = 3

[lanes]
dev_only = ["src/types/db.ts", "generated/"]'
V3_NO_LANES='schema = 3

[paths]
src = "web/src"'
checkb 1 "$V3" prod chore src/types/db.ts
checkb 1 "$V3" prod chore generated/x.ts
checkb 0 "$V3" prod chore README.md
check 1 "$V3"            chore src/types/db.ts
check 1 "$V3"            design src/types/db.ts
check 0 "$V3"            dev    src/types/db.ts
checkb 0 "$V3_NO_LANES" prod chore src/types/db.ts README.md
checkb 1 "$V3_NO_LANES" prod chore supabase/migrations/1.sql
checkb 0 'schema = 3' prod chore src/types/db.ts
checkb 0 'schema = 2' prod chore src/a.ts

# Config edge cases: no file or no [lanes] means only supabase/ is dev-only;
# multi-line arrays, comments, single quotes and directory entries are read;
# a dev_only key in another section is not.
check 1 -                      design src/types/db.ts
check 1 '[app]
name = "x"'                    design src/types/db.ts
check 1 "$MULTI"               design design/a.md src/types/db.ts
check 1 "$MULTI"               design generated/x.ts
check 0 "$MULTI"               design design/a.md design/b.tsx
check 0 "$DB_TS"               dev    src/types/db.ts supabase/config.toml
check 0 "$DB_TS"               design design/supabase-notes.md

# ── A kit project: the commit holds frontend/src/design/manifest.json ──────
# Its design lane owns the kit's app files (scripts/design-owned.txt) and its dev and chore lanes
# do not; it has no design/ folder, so every lane refuses design/. Any other project is unchanged.
KIT_PUB=frontend/public
check_kit_says() {   # check_kit_says <exit> <text the guard prints> <branch> <files…>, run in a kit project
  local expected="$1" want="$2" dir out code
  shift 2
  dir="$(mktemp -d "$WORK/case.XXXXXX")"
  mkdir -p "$dir/frontend/src/design" && printf '{}\n' > "$dir/frontend/src/design/manifest.json"
  out="$(cd "$dir" && bash "$GUARD" "$@" 2>&1)"
  code=$?
  if [ "$code" = "$expected" ] && printf '%s' "$out" | grep -qF -- "$want"; then pass=$((pass + 1)); echo "ok   kit says '$want'"
  else fail=$((fail + 1)); echo "FAIL kit $* -> exit $code, expected $expected and \"$want\"; output: ${out:-<none>}"; fi
}
KIT=1 check 0 - dev     $KIT_PUB/_headers src/a.ts frontend/src/App.tsx
KIT=1 check 1 - dev     $KIT_PUB/robots.txt
KIT=1 check 1 - dev     frontend/src/design/brand.json
KIT=1 check 1 - dev     src/a.ts $KIT_PUB/icons/a.svg
KIT=1 check 1 - dev     $KIT_PUB/fonts/x.woff2
KIT=1 check 1 - dev     $KIT_PUB/favicon.ico
KIT=1 check 0 - design  frontend/src/design/brand.json $KIT_PUB/logo.svg $KIT_PUB/img/hero.jpg $KIT_PUB/brand/a.svg
KIT=1 check 0 - design  $KIT_PUB/icon-maskable-512.png $KIT_PUB/og-image.jpg $KIT_PUB/humans.txt
KIT=1 check 0 - design  screenplay/x-snapshots/a-linux.png
KIT=1 check 0 - design  frontend/src/design/tokens.css screenplay/tests/a.spec.ts-snapshots/a-linux.png
KIT=1 check 1 - design  frontend/src/App.tsx
KIT=1 check 1 - design  frontend/src/design/brand.json frontend/src/App.tsx
KIT=1 check 1 - design  $KIT_PUB/_headers
KIT=1 check 1 - design  $KIT_PUB/other/a.svg
KIT=1 check 1 - design  screenplay/x-snapshots/a-darwin.png
KIT=1 check 1 - design  supabase/functions/x/index.ts
KIT=1 check 1 - chore   $KIT_PUB/robots.txt
KIT=1 check 1 - chore   frontend/src/design/brand.json
KIT=1 check 0 - chore   README.md $KIT_PUB/_headers
KIT=1 check 1 - chore   supabase/migrations/1.sql             # chore's other limits stay
KIT=1 check 1 "$DB_TS" chore src/types/db.ts
KIT=1 check 0 "$DB_TS" dev    src/types/db.ts
KIT=1 check 1 - dev     design/guidebook.toml                 # a kit project has no design/
KIT=1 check 1 - design  design/guidebook.toml
KIT=1 check 1 - design  design/a.md frontend/src/design/brand.json
KIT=1 check 1 - chore   design/logo.svg
KIT=1 check 1 - design  design/screenplay/x-snapshots/a-linux.png
KIT=1 checkb 0 - prod staging  $KIT_PUB/robots.txt design/a.md frontend/src/App.tsx   # staging brings anything
KIT=1 checkb 1 - prod chore    $KIT_PUB/robots.txt
KIT=1 checkb 1 - prod chore    design/logo.svg
KIT=1 checkb 1 - prod chore    supabase/migrations/1.sql
KIT=1 checkb 0 - prod chore    README.md
KIT=1 checkb 1 - prod dev      src/a.ts
KIT=1 checkb 1 - prod design   frontend/src/design/brand.json
KIT=1 check 1 - dev     supabase/001_loose.sql                # a migration lives only in supabase/migrations/
# Any other project keeps today's rules: owned paths are open to dev, design/ is the design lane's.
check 0 -       dev     $KIT_PUB/robots.txt frontend/src/design/brand.json $KIT_PUB/icons/a.svg
check 1 -       design  $KIT_PUB/robots.txt
check 1 -       design  frontend/src/design/brand.json
check 0 -       chore   $KIT_PUB/robots.txt frontend/src/design/brand.json
check 0 -       design  design/a.md
check_kit_says 1 'keeps its design in the design repo' dev design/a.md
check_kit_says 1 'has no design/ folder' design design/a.md
check_kit_says 1 'has no design/ folder' chore design/a.md
check_kit_says 1 'design lane' dev $KIT_PUB/robots.txt
check_kit_says 1 'design lane' chore frontend/src/design/brand.json
check_kit_says 1 "$KIT_PUB/robots.txt" dev $KIT_PUB/robots.txt
check_kit_says 1 "only the design kit's files" design frontend/src/App.tsx
check_kit_says 0 'design lane' design frontend/src/design/brand.json

# ── design-owned.txt is the kit's own list: `design-kit owned app` ──────────
# The guard keeps a copy; this compares it with the kit when the kit is at the platform's usual
# place (or $SPD_DESIGN_KIT), and says so when it skips.
KIT_DIR="${SPD_DESIGN_KIT:-/Users/corner/dev/platform/project/spd-hub/app/packages/design-kit}"
if [ -f "$KIT_DIR/src/cli.ts" ] && command -v bun >/dev/null 2>&1; then
  want_owned="$(bun "$KIT_DIR/src/cli.ts" owned app 2>&1)"
  if [ "$want_owned" = "$(cat "$HERE/design-owned.txt" 2>/dev/null)" ]; then
    pass=$((pass + 1)); echo "ok   design-owned.txt equals 'design-kit owned app'"
  else
    fail=$((fail + 1)); echo "FAIL design-owned.txt differs from 'design-kit owned app'; refresh it: bun $KIT_DIR/src/cli.ts owned app > scripts/design-owned.txt"
  fi
else
  echo "skip design-owned.txt vs the kit: no design-kit at $KIT_DIR (set SPD_DESIGN_KIT) or no bun"
fi

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
check_pr 0 '' "$R" design 'mkdir -p screenplay/tests/a.spec.ts-snapshots && echo x > screenplay/tests/a.spec.ts-snapshots/a-linux.png'
check_pr 0 '' "$R" chore 'echo x >> README.md'
check_pr 1 'supabase/' "$R" chore 'echo "select 2;" > supabase/migrations/003.sql'
check_pr 1 'src/types/db.ts' "$R" chore 'echo "// x" >> src/types/db.ts'
check_pr 0 'carries schema migrations: supabase/migrations/002_more.sql' "$R" dev "printf -- '-- forward-only: reads only\\nselect 1;\\n' > supabase/migrations/002_more.sql"
check_pr 1 'design/a.md' "$R" dev 'echo y >> design/a.md'
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


# A migration lives only in supabase/migrations/ (Jon, 2026-10-28), on every lane and base.
check 1 - dev db/migrations/001_init.sql
check 1 - dev migrations/20261028_add_users.sql
check 1 - dev frontend/migrations/002_x.sql
check 1 - dev supabase/001_loose.sql
check 1 - dev supabase/schema/migrations/003_nested.sql
checkb 1 - prod staging db/migrations/001_init.sql
check 0 - dev supabase/migrations/001_init.sql supabase/tests/schema.sql
check 0 - dev supabase/seed.sql supabase/tests/a.sql supabase/migrations/undo/001_init.down.sql
check 0 - dev scripts/report.sql


# Migrations, by content (Jon, 2026-10-28): an applied migration never changes; a new one brings its
# undo file or says why it is forward-only.
MR="$(new_repo no)"
check_pr 1 'never changes' "$MR" dev "printf 'alter table t add column x int;\n' >> supabase/migrations/001_init.sql"
check_pr 1 'never changes' "$MR" dev "git rm -q supabase/migrations/001_init.sql"
check_pr 1 'undo/002_add.down.sql' "$MR" dev "printf 'alter table t add column a int;\n' > supabase/migrations/002_add.sql"
check_pr 0 '' "$MR" dev "printf 'alter table t add column a int;\n' > supabase/migrations/002_add.sql && mkdir -p supabase/migrations/undo && printf 'alter table t drop column a;\n' > supabase/migrations/undo/002_add.down.sql"
check_pr 0 '' "$MR" dev "printf -- '-- forward-only: drops nothing, adds a nullable column\nalter table t add column a int;\n' > supabase/migrations/002_add.sql"
check_pr 1 'forward-only' "$MR" dev "printf -- '-- forward-only:\nalter table t add column a int;\n' > supabase/migrations/002_add.sql"

# A kit project through lane-guard-pr.sh: the checkout is the head commit, so its manifest makes the kit.
KR="$(new_repo yes)"
(cd "$KR" && git checkout -q staging && mkdir -p frontend/src/design frontend/public && printf '{}\n' > frontend/src/design/manifest.json && git rm -rq design && git add -A && git commit -qm kit) >/dev/null
check_pr 0 '' "$KR" design 'echo x > frontend/src/design/brand.json && echo y > frontend/public/logo.svg'
check_pr 1 'design lane' "$KR" dev 'mkdir -p frontend/public && echo y > frontend/public/robots.txt'
check_pr 0 '' "$KR" dev 'echo "// y" >> src/App.tsx'
check_pr 1 'frontend/src/App.tsx' "$KR" design 'mkdir -p frontend/src && echo y > frontend/src/App.tsx'
check_pr 1 'no design/' "$KR" chore 'mkdir -p design && echo y > design/a.md'

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
