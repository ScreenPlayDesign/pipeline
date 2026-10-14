// scripts/rehearsal/cli.ts — the steps dress-rehearsal.yml runs.
//   bun cli.ts config   → slug=… / staging_url=… (for $GITHUB_OUTPUT)
//   bun cli.ts wait     → waits for STAGING_URL to serve GITHUB_SHA; exits 1 with the reason
//   bun cli.ts post     → posts the rehearsal; appends verdict= / description= to $GITHUB_OUTPUT
//   bun cli.ts pgenv    → prints export lines for STAGING_DB_URL's libpq PG* variables (for eval)
import { appendFileSync } from 'node:fs'
import { readProjectConfig } from './config.ts'
import { waitForBuild } from './buildInfo.ts'
import { postRehearsal } from './post.ts'
import { pgEnvFromUrl, shellExports } from './pgenv.ts'

const cmd = process.argv[2]
if (cmd === 'config') {
  const c = readProjectConfig(process.cwd())
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
} else if (cmd === 'pgenv') {
  const url = process.env.STAGING_DB_URL ?? ''
  if (!url) { console.error('STAGING_DB_URL is not set'); process.exit(1) }
  try { process.stdout.write(shellExports(pgEnvFromUrl(url))) } catch (e) { console.error((e as Error).message); process.exit(1) }
} else {
  console.error('usage: bun cli.ts config|wait|post|pgenv')
  process.exit(2)
}
