// scripts/rehearsal/cli.ts — the steps dress-rehearsal.yml runs.
//   bun cli.ts config   → slug=… / staging_url=… / playwright_image=… / playwright_matched=… (for $GITHUB_OUTPUT)
//   bun cli.ts wait     → waits for STAGING_URL to serve GITHUB_SHA; exits 1 with the reason
//   bun cli.ts wait-migrations → waits for commit status supabase/staging-deploy = success (absent: continues after 5 min)
//   bun cli.ts post     → posts the rehearsal; appends verdict= / description= to $GITHUB_OUTPUT
//   bun cli.ts playwright-config → prints the project's Playwright config path (relative), or nothing
//   bun cli.ts reset-cast → runs ${PROJECT_ROOT}/supabase/testing/reset.sql against STAGING_DB_URL (skips with a warning if either is missing)
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, readProjectConfig } from './config.ts'
import { waitForBuild } from './buildInfo.ts'
import { waitForStagingDeploy } from './stagingStatus.ts'
import { postRehearsal } from './post.ts'
import { resetCast } from './reset.ts'
import { playwrightOutputs } from './playwrightImage.ts'
import { playwrightConfigFor } from './layout.ts'

const cmd = process.argv[2]
// The reason goes to the job output so the gate can say why staging was not ready.
function waitFailed(reason: string): never {
  console.error(`::error::${reason.replace(/[\r\n]+/g, ' ')}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reason=${reason.replace(/[\r\n]+/g, ' ').slice(0, 140)}\n`)
  process.exit(1)
}
if (cmd === 'config') {
  const c = readProjectConfig(projectRoot())
  console.log(`slug=${c.slug}`)
  console.log(`staging_url=${c.stagingUrl}`)
  // The scenes' container: read from bun.lock as text, never run.
  const lock = join(projectRoot(), 'bun.lock')
  const pw = playwrightOutputs(existsSync(lock) ? readFileSync(lock, 'utf8') : null)
  console.log(`playwright_image=${pw.playwright_image}`)
  console.log(`playwright_matched=${pw.playwright_matched}`)
} else if (cmd === 'wait') {
  const r = await waitForBuild(process.env.STAGING_URL ?? '', process.env.GITHUB_SHA ?? '')
  if (!r.ok) { waitFailed(r.reason) }
  console.log('staging serves this commit')
} else if (cmd === 'wait-migrations') {
  const r = await waitForStagingDeploy(process.env.GITHUB_REPOSITORY ?? '', process.env.GITHUB_SHA ?? '', process.env.GITHUB_TOKEN ?? '')
  if (!r.ok) { waitFailed(r.reason) }
  if (r.note) console.log(`::notice::${r.note}`)
  else console.log('staging migrations are applied')
} else if (cmd === 'post') {
  const r = await postRehearsal()
  const out = process.env.GITHUB_OUTPUT
  const line = r.description.replace(/[\r\n]+/g, ' ').slice(0, 140)
  if (out) appendFileSync(out, `verdict=${r.verdict}\ndescription=${line}\n`)
  console.log(`verdict: ${r.verdict} — ${line}`)
} else if (cmd === 'reset-cast') {
  const url = process.env.STAGING_DB_URL ?? ''
  const file = join(projectRoot(), 'supabase', 'testing', 'reset.sql')
  if (!url || !existsSync(file)) {
    console.log('::warning::No STAGING_DB_URL or supabase/testing/reset.sql — cast not reset; scenes that need the cast will skip and count as not passed.')
  } else {
    try { await resetCast(url, readFileSync(file, 'utf8')); console.log('cast reset') } catch (e) { console.error((e as Error).message); process.exit(1) }
  }
} else if (cmd === 'playwright-config') {
  const cfg = playwrightConfigFor(projectRoot())
  if (cfg) console.log(cfg)
} else {
  console.error('usage: bun cli.ts config|wait|wait-migrations|post|reset-cast|playwright-config')
  process.exit(2)
}
