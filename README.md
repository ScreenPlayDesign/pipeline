# spd-pipeline

**Where jobs run.** Every job here uses
`runs-on: ${{ fromJSON(vars.SPD_RUNS_ON || '"ubuntu-latest"') }}`: GitHub's hosted
machines unless the organisation variable `SPD_RUNS_ON` names others. Set it to
`["self-hosted","playhouse"]` to run on the Playhouse's runners on the mini
(playhouse/docs/runners.md); set it back to `"ubuntu-latest"` when the mini is off.

Canonical CI/CD reusable workflows for every ScreenPlayDesign project.
**Corrected 2026-07-06:** only two files live here now — `ci.yml` and
`deploy-prod.yml`. `deploy-dev.yml` and `deploy-staging.yml` were deleted
outright (they only ever built an artifact for `github-app`'s now-removed
deploy-relay path, no other irreplaceable logic). `deploy-prod.yml` was
gutted the same day — it no longer builds or deploys anything either.
Cloudflare Pages' own native Git integration builds and deploys every
environment (`dev`/`staging`/`prod`) directly now; no GitHub Actions
workflow is involved in the actual deploy step anywhere in this pipeline.
`ci.yml` remains the one file that still does real typecheck/build/
Playwright work, `workflow_call`-only.

**Gutted FURTHER, same day:** `deploy-prod.yml` also no longer tags releases
or bumps `CHANGELOG.md`/`package.json` — that moved to `ScreenPlayDesign/
github-app`'s `publishRelease()`, triggered directly off the `push` webhook
the instant a merge lands on `prod`, rather than run from this workflow.
Reason: the old version pushed that bookkeeping commit straight onto `prod`,
which meant `prod` was permanently one commit ahead of `staging` — so the
very next staging→prod PR always opened "out of date with base branch,"
every release, not occasionally. `deploy-prod.yml` now exists solely for the
human-gated rollback mechanism (`rollback-to-tag`) — see its own header
comment for the full reasoning and the honest trade-off it creates (the
`environment: production` approval gate no longer gates anything on a normal
release, only on a rollback).

**This repo is public on purpose.** GitHub's reusable-workflow `uses:`
mechanism only allows a cross-organization reference when the source repo
is public — a private repo's reusable workflows can only be called by
repos in the same org. Some SPD projects live in GitHub organizations
other than ScreenPlayDesign, so a private repo here would silently fail to
work for them. Being public costs nothing sensitive: no secret *values*
ever live in these files (`${{ secrets.X }}` always resolves against the
*calling* repo's own runtime), and no orchestration/business logic lives
here either — that's `ScreenPlayDesign/github-app`, kept private.

## What's NOT here

- **Standing-PR orchestration, webhook handling, provisioning** —
  `ScreenPlayDesign/github-app` (private). That repo acts on other repos
  via the GitHub API; nothing ever needs to `uses:` it, so it doesn't need
  to be public.
- **Project starter code** — `ScreenPlayDesign/foundation-template`. A new
  project clones that repo wholesale; it only keeps a handful of thin
  trigger files pointing back here, not a copy of these workflows.

## Usage

A consuming repo needs one thin file per workflow — the actual trigger,
plus a `uses:` call back here:

```yaml
# a project's run-deploy-prod.yml
on:
  push:
    branches: [prod]
permissions:
  contents: write
jobs:
  deploy:
    uses: ScreenPlayDesign/pipeline/.github/workflows/deploy-prod.yml@<commit sha> # main as of YYYY-MM-DD
    secrets:
      PR_BOT_TOKEN: ${{ secrets.PR_BOT_TOKEN }}
```

Callers pass `pipeline-ref` with the same commit they pin in `uses:` (the
rehearsal checks out its scripts at that commit):

```yaml
jobs:
  rehearse:
    uses: ScreenPlayDesign/pipeline/.github/workflows/dress-rehearsal.yml@<commit sha>
    with:
      pipeline-ref: <commit sha>
    secrets:
      SPD_REHEARSAL_TOKEN:              ${{ secrets.SPD_REHEARSAL_TOKEN }}
      STAGING_DB_URL:                   ${{ secrets.STAGING_DB_URL }}
      STAGING_SUPABASE_URL:             ${{ secrets.STAGING_SUPABASE_URL }}
      STAGING_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.STAGING_SUPABASE_PUBLISHABLE_KEY }}
```

Pass each secret by name — never `secrets: inherit`. This repo is public:
with `inherit`, one bad change here would hand every caller's secrets to
it. Each workflow declares the secrets it accepts under `workflow_call:`
(`ci.yml`: `SPD_API_TOKEN`, `STAGING_SUPABASE_URL`,
`STAGING_SUPABASE_PUBLISHABLE_KEY`; `dress-rehearsal.yml`:
`SPD_REHEARSAL_TOKEN`; `deploy-prod.yml`: `PR_BOT_TOKEN`).
`SPD_API_TOKEN` is a per-project CI token (dashboard Settings → API tokens
→ "CI · <project>"), never a personal one. `vars` and `github.event.*`
resolve against the **calling** repo's own run, not this one.
`deploy-prod.yml` no longer reads any Cloudflare-related variable or
secret at all — see the Workflows table below.

See `ScreenPlayDesign/foundation-template/.github/README.md` for the full
pipeline diagram, required repo variables/secrets, and the branch
protection settings each consuming repo needs (including the composite
check names this pattern produces, e.g. `ci / TypeScript + Build smoke
test` — that's the one real cost of calling a reusable workflow instead of
triggering directly, and it needs to be reflected in each repo's required
status checks).

## Workflows

| File | Triggers via caller | What it does |
|---|---|---|
| `ci.yml` | `pull_request` on staging, dev, design, prod (+ `push` on prod for some projects) | TypeScript + build always. On PRs into staging: the lane guard (`scripts/lane-guard-pr.sh` → `lane-guard.sh`: only `dev` and `design` PR into staging; `dev` never touches `design/`; `design` never touches `supabase/` or the base's `[lanes] dev_only` paths) and, for `dev`/`design`, `Rehearsal evidence` (`spd/local-rehearsal` or `spd/stage-rehearsal` in state `success` on the head commit). The Gherkin/Playwright visual gate runs on every event except PRs into staging. Afterwards it posts results with the project's `.stage/scripts/post-spd-results.ts`, or `scripts/post-spd-results.ts` in older projects. Callers pass `pipeline-ref` (the commit pinned in `uses:`) and grant `contents: read` and `statuses: read`. |
| `deploy-prod.yml` | `workflow_dispatch` with `rollback-to-tag` (a normal push does nothing here anymore) | **Rollback only.** Overlays an old release tag's file tree onto the current `prod` tip as a new forward commit (never force-pushes or resets history). Gated behind this workflow's `environment: production` approval — the one remaining thing that gate meaningfully blocks, now that release tagging/CHANGELOG happens automatically via `github-app`'s `publishRelease()` instead (see that repo's `handlers.ts`). See the file's own header comment for the full mechanics and the trade-off this split creates. |
| `dress-rehearsal.yml` | `push` on staging (+ `workflow_dispatch`) via `run-dress-rehearsal.yml` | Waits until staging serves the commit, resets the cast, performs every Gherkin scene against staging (with `.stage/config/playwright.config.ts`, or the root `playwright.config.ts` in older projects), posts scenes/results/screenshots and the verdict to screenplaydesign.com, and sets the required commit status `screenplay / dress rehearsal`. Scenarios tagged `@later` never block. Four jobs — `start`, `reset`, `perform`, `verdict` — so project code never runs where a token or `statuses: write` is held. Callers grant `contents: read` and `statuses: write`. |
| `approve-screenshots.yml` | `workflow_dispatch` via `run-approve-screenshots.yml` | Renders every scene on Linux against staging (same Playwright config lookup) and commits new or changed `*-linux.png` baselines to the `design` lane for the designer to approve. Needs `PR_BOT_TOKEN`. |

`deploy-dev.yml` and `deploy-staging.yml` no longer exist — deleted
2026-07-06. They only ever built an artifact for `github-app`'s deploy-relay
path, which was removed the same day; there was no other logic in them
worth keeping. Cloudflare Pages' native Git integration (configured once in
the Cloudflare dashboard, not through this repo) now builds and deploys
`dev`/`staging`/`prod` directly on every push, with no GitHub Actions
workflow involved.

## Versioning

Consuming repos pin a full commit SHA of `main`, not `@main` (audit
2026-10-14, H3): a push here must not reach every project's CI unreviewed.
Updating a project to a newer pipeline is a one-line change to that pin.
Third-party actions inside these workflows are pinned by SHA too, with the
release tag in a comment.
