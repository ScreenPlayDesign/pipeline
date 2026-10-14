// scripts/rehearsal/cli.ts — the steps dress-rehearsal.yml runs.
//   bun cli.ts config   → slug=… / staging_url=… (for $GITHUB_OUTPUT)
//   bun cli.ts wait     → waits for STAGING_URL to serve GITHUB_SHA; exits 1 with the reason
//   bun cli.ts post     → posts the rehearsal; appends verdict= / description= to $GITHUB_OUTPUT
//   bun cli.ts reset-cast → runs ${PROJECT_ROOT}/supabase/testing/reset.sql against STAGING_DB_URL (skips with a warning if either is missing)
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectRoot, readProjectConfig } from './config.ts'
import { waitForBuild } from './buildInfo.ts'
import { postRehearsal } from './post.ts'
import { resetCast } from './reset.ts'

const cmd = process.argv[2]
if (cmd === 'config') {
  const c = readProjectConfig(projectRoot())
  console.log(`slug=${c.slug}`)
  console.log(`staging_url=${c.stagingUrl}`)
} else if (cmd === 'wait') {
  const r = await waitForBuild(process.env.STAGING_URL ?? '', process.env.GITHUB_SHA ?? '')
  if (!r.ok) { console.error(r.reason); process.exit(1) }
  console.log('staging serves this commit')
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
} else {
  console.error('usage: bun cli.ts config|wait|post|reset-cast')
  process.exit(2)
}
