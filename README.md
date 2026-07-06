# spd-pipeline

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
jobs:
  deploy:
    uses: ScreenPlayDesign/pipeline/.github/workflows/deploy-prod.yml@main
    secrets: inherit
```

`vars`, `secrets` (via `secrets: inherit`), and `github.event.*` all
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
| `ci.yml` | `pull_request` on staging/prod (+ `push` on prod for some projects) | Two parallel jobs: TypeScript + build, and the Gherkin/Playwright visual gate |
| `deploy-prod.yml` | `push` on prod (via the calling repo's own trigger) | **Release bookkeeping only — no build, no deploy.** Tags a release (`vYYYY.MM.DD.N`), writes a CHANGELOG.md entry, bumps `package.json`'s version, and supports rollback (`rollback-to-tag` input: overlays an old tag's tree onto current `prod` as a new commit). Two human gates remain between staging and prod on purpose: the staging→prod PR itself (opened/refreshed by `github-app`, never auto-merged), and this workflow's own `environment: production` approval gate. See the file's own header comment for the full rollback mechanics. |

`deploy-dev.yml` and `deploy-staging.yml` no longer exist — deleted
2026-07-06. They only ever built an artifact for `github-app`'s deploy-relay
path, which was removed the same day; there was no other logic in them
worth keeping. Cloudflare Pages' native Git integration (configured once in
the Cloudflare dashboard, not through this repo) now builds and deploys
`dev`/`staging`/`prod` directly on every push, with no GitHub Actions
workflow involved.

## Versioning

Consuming repos pin `@main`. There's no separate stable/dev split like
foundation-template has (its own `dev`/`prod` branches gate *its own*
deploy) — this repo has no app to deploy, so a merge to `main` is the
release. Keep changes here small and reviewed; every project depending on
`@main` picks up a change the moment it lands.
