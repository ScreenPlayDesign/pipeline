# spd-pipeline

The reusable GitHub Actions workflows and guard scripts that every
ScreenPlayDesign project calls. Each project keeps thin trigger files
(`run-ci.yml`, `run-dress-rehearsal.yml`, `run-deploy-prod.yml`,
`run-approve-screenshots.yml`) that declare a trigger and call a workflow here.

This repo is public so projects in any GitHub organisation can call it (a
cross-organisation `uses:` needs a public source). It holds no secret values:
`secrets.*` and `vars.*` resolve against the calling repo. Orchestration lives
in `ScreenPlayDesign/github-app` (SPD Bot, private); project starter code lives
in `ScreenPlayDesign/foundation-template`. Cloudflare Pages builds and deploys
from Git; no workflow here deploys.

**The lanes.** An app repo has the lanes chore, dev, design, staging and prod,
plus `release` (cut by SPD Bot) and `proposal-1` to `proposal-8`. There is no
`main`. A site repo (`<project>-site`) has chore, design, staging and prod.
The guard below is written for the app's lanes; a site's rules are planned
(the project model, 2026-10-27).

**How the pipeline reads `spd_config.toml`.** Only through
`scripts/spd-config.ts`, a byte-for-byte copy of the client's one schema
(version 2), checked by its hash. The lane guard reads `[lanes] dev_only`
with it; the rehearsal reads the app name and `[env.staging] url` with it
(`scripts/rehearsal/config.ts`). The platform's database is the truth and the
file is its copy. A version 1 file loads through an in-memory migration.

**Where jobs run.** Every job uses
`runs-on: ${{ fromJSON(vars.SPD_RUNS_ON || '"ubuntu-latest"') }}`: GitHub's hosted
machines unless the organisation variable `SPD_RUNS_ON` names others. Set it to
`["self-hosted","playhouse"]` to run on the Playhouse's runners
(playhouse/docs/runners.md); set it back to `"ubuntu-latest"` when they are off.

## Workflows

| File | Triggers via caller | What it does |
|---|---|---|
| `ci.yml` | `pull_request` on staging, prod (and any other branch the caller lists); `push` on prod for some projects | `lane-guard` on PRs into staging or prod (`scripts/lane-guard-pr.sh` → `lane-guard.sh`). `Rehearsal evidence` on PRs into staging from `dev` or `design`: the head commit needs `spd/local-rehearsal` or `spd/stage-rehearsal` in state `success`. `TypeScript + Build smoke test` always. `Gherkin + Playwright visual gate` on every event except a PR into staging; it posts results with the project's `.stage/scripts/post-spd-results.ts` (or `scripts/post-spd-results.ts` in older projects). Callers pass `pipeline-ref` and grant `contents: read` and `statuses: read`. |
| `dress-rehearsal.yml` | `push` on staging, `workflow_dispatch` | Waits until staging serves the commit and its migrations, resets the cast, performs every Gherkin scene against staging (with `.stage/config/playwright.config.ts`, or the root `playwright.config.ts` in older projects), posts scenes, results, screenshots and the verdict to screenplaydesign.com, and sets the commit status `screenplay / dress rehearsal`. Scenarios tagged `@later` never block. Four jobs (`start`, `reset`, `perform`, `verdict`) so project code never runs where a token or `statuses: write` is held. Callers grant `contents: read` and `statuses: write`. |
| `deploy-prod.yml` | `workflow_dispatch` with `rollback-to-tag` (without a tag it does nothing) | Rollback only. Overlays an old release tag's file tree onto the `prod` tip as one new forward commit; never force-pushes. Waits for the `production` environment's reviewers. The release (tag, CHANGELOG, version bump) is cut by SPD Bot (`github-app`) on the `release` branch once `supabase-prod.yml` has succeeded on `prod`'s tip, never by a workflow here. |
| `approve-screenshots.yml` | `workflow_dispatch` | Reads `spd_config.toml`, then renders every scene on Linux against staging and commits new or changed `*-linux.png` baselines to the `design` lane. Needs `PR_BOT_TOKEN`. |

## The lane guard

`scripts/lane-guard.sh <head-branch> <files…>` decides whether a lane may bring
a set of files to a base (`LANE_BASE`, `staging` or `prod`);
`scripts/lane-guard-pr.sh` lists the PR's files and calls it. Tests:
`bash scripts/lane-guard.test.sh`.

| Base | Head | Rule |
|---|---|---|
| staging | `dev` | may change anything but `design/`, `supabase/` included |
| staging | `design` | may change only `design/` |
| staging | `chore` | may change anything but `supabase/`, a dev-only path or `design/` |
| staging | `proposal-N`, anything else | refused |
| prod | `staging` | may bring anything |
| prod | `chore` | may change anything but `supabase/`, a dev-only path or `design/` |
| prod | anything else | refused |

Dev-only paths are `supabase/` plus the `[lanes] dev_only` list in the base's
`spd_config.toml` (for example `frontend/src/types/db.ts`). The list is read
from the base, so a PR cannot drop an entry and change that file in the same
PR. Moves count both paths. A file changed only by a release bump commit
(`docs: release vYYYY.MM.DD.N`, touching CHANGELOG.md and the `version` line of
package.json) is left out.

## Bun

Every job installs the Bun version in the project's `package.json`
`packageManager` (`"bun@x.y.z"`). A project that does not set it gets
`SPD_BUN_DEFAULT`, one pinned version declared in each workflow's `env:`
(currently 1.3.14). Pipeline scripts run with `bun --no-env-file`, so a
project's `bunfig.toml` or `.env` never loads into them.

## Usage

```yaml
# a project's run-ci.yml
jobs:
  ci:
    uses: ScreenPlayDesign/pipeline/.github/workflows/ci.yml@<commit sha>
    with:
      pipeline-ref: <commit sha>
    secrets:
      SPD_API_TOKEN:                    ${{ secrets.SPD_API_TOKEN }}
      STAGING_SUPABASE_URL:             ${{ secrets.STAGING_SUPABASE_URL }}
      STAGING_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.STAGING_SUPABASE_PUBLISHABLE_KEY }}
```

`pipeline-ref` is the same commit as in `uses:`; the workflows check their
scripts out at it. Pass each secret by name, never `secrets: inherit`: this
repo is public, and `inherit` would hand every caller secret to it. Secrets
each workflow accepts:

| Workflow | Secrets |
|---|---|
| `ci.yml` | `SPD_API_TOKEN` (per-project CI token), `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY` |
| `dress-rehearsal.yml` | `SPD_REHEARSAL_TOKEN`, `STAGING_DB_URL`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY` |
| `deploy-prod.yml` | `PR_BOT_TOKEN` |
| `approve-screenshots.yml` | `PR_BOT_TOKEN`, `STAGING_DB_URL`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY` |

A required check is named `<caller job id> / <job name>`, for example
`ci / TypeScript + Build smoke test`. The required checks and repo variables
for each branch are listed in `foundation-template/.github/README.md`.

## Versioning

Callers pin a full commit SHA of `main`, never `@main`, so a push here does not
reach every project's CI unreviewed. Updating a project is a change to its pins.
Third-party actions in these workflows are pinned by SHA, with the release tag
in a comment.

## Tests

```
bun test scripts/rehearsal
bash scripts/lane-guard.test.sh
```
