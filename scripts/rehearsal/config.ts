// scripts/rehearsal/config.ts — what the rehearsal needs from the hub's project record.
import { fetchRecord } from '../project-record.ts'

export interface RehearsalConfig { slug: string; stagingUrl: string }

export const DEFAULT_API = 'https://screenplaydesign.com/api/cli'

/**
 * The slug and staging URL come from the hub's record for this repo (GITHUB_REPOSITORY, SPD_REHEARSAL_TOKEN),
 * not from the project's file. CI has no cache: a hub that cannot be reached, or any answer but 200, fails the step.
 */
export async function readProjectConfig(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<RehearsalConfig> {
  const full = env.GITHUB_REPOSITORY ?? ''
  const [org, repo, ...extra] = full.split('/')
  if (!org || !repo || extra.length) throw new Error(`GITHUB_REPOSITORY is not "<org>/<repo>": "${full}"`)
  const token = env.SPD_REHEARSAL_TOKEN ?? ''
  if (!token) throw new Error('SPD_REHEARSAL_TOKEN is not set; the caller must pass the repo\'s rehearsal token (spd ci setup)')
  const api = env.SPD_API_URL || DEFAULT_API
  const got = await fetchRecord({ api, token, repo: { org, repo }, fetch: fetchImpl })
  if (!got.ok) {
    if (got.status === 403) throw new Error("this repo's rehearsal token cannot read its record")
    if (got.status === 404) throw new Error(`the hub has no project record for ${full}`)
    if (got.status === 'offline') throw new Error(`the hub at ${api} could not be reached, and CI has no cache to fall back on`)
    throw new Error(`the hub at ${api} answered ${got.status} for the record of ${full}`)
  }
  const slug = got.record.slug
  const stagingUrl = got.record.urls?.staging
  if (!slug) throw new Error(`the hub's record for ${full} has no slug`)
  if (typeof stagingUrl !== 'string' || !stagingUrl) throw new Error(`the hub's record for ${full} has no staging URL`)
  return { slug, stagingUrl: stagingUrl.replace(/\/$/, '') }
}

/** The project checkout. Workflows run pipeline code from outside it and pass it in. */
export function projectRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROJECT_ROOT || process.cwd()
}
