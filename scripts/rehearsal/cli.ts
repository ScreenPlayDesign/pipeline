// scripts/rehearsal/cli.ts — the steps dress-rehearsal.yml runs.
//   bun cli.ts config   → slug=… / staging_url=… (for $GITHUB_OUTPUT)
//   bun cli.ts wait     → waits for STAGING_URL to serve GITHUB_SHA; exits 1 with the reason
//   bun cli.ts post     → posts the rehearsal; appends verdict= / description= to $GITHUB_OUTPUT
import { appendFileSync } from 'node:fs'
import { readProjectConfig } from './config.ts'
import { waitForBuild } from './buildInfo.ts'
import { postRehearsal } from './post.ts'

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
} else {
  console.error('usage: bun cli.ts config|wait|post')
  process.exit(2)
}
