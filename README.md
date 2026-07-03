# spd-pipeline

Canonical CI/CD reusable workflows for every ScreenPlayDesign project —
`ci.yml`, `deploy-dev.yml`, `deploy-staging.yml`, `deploy-prod.yml`. The
actual typecheck/build/Playwright/Cloudflare-deploy steps live here, once,
`workflow_call`-only.

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
resolve against the **calling** repo's own run, not this one — a
project's own `CLOUDFLARE_PROJECT_NAME` repo variable is what
`deploy-prod.yml` reads even though the file lives here.

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
| `deploy-dev.yml` | `push` on dev | Build + deploy to Cloudflare Pages dev preview, using staging credentials |
| `deploy-staging.yml` | `push` on staging | Build + deploy to staging, then a behavior-only smoke test against the live URL |
| `deploy-prod.yml` | `push` on prod (+ `workflow_dispatch`) | Build + deploy to prod behind the `production` environment approval gate, tags a release, updates CHANGELOG.md |

## Versioning

Consuming repos pin `@main`. There's no separate stable/dev split like
foundation-template has (its own `dev`/`prod` branches gate *its own*
deploy) — this repo has no app to deploy, so a merge to `main` is the
release. Keep changes here small and reviewed; every project depending on
`@main` picks up a change the moment it lands.
