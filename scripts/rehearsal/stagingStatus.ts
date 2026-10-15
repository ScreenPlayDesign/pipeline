// scripts/rehearsal/stagingStatus.ts — has the staging database been migrated yet?
// The project's Supabase deploy posts commit status `supabase/staging-deploy`.
// Projects without Supabase never post it, so an absent status is waited for
// only for a short grace period and then ignored.
export const STAGING_DEPLOY_CONTEXT = 'supabase/staging-deploy'

export type StagingDeployDecision =
  | { action: 'done' } | { action: 'wait' }
  | { action: 'continue'; note: string } | { action: 'failed'; reason: string }

export function decideStagingDeploy(a: { state: string | null; elapsedMs: number; graceMs: number; timeoutMs: number }): StagingDeployDecision {
  if (a.state === 'success') return { action: 'done' }
  if (a.state === 'failure' || a.state === 'error') {
    return { action: 'failed', reason: `The staging database migrations did not finish: ${STAGING_DEPLOY_CONTEXT} is ${a.state}` }
  }
  if (a.state === null) {
    return a.elapsedMs >= a.graceMs
      ? { action: 'continue', note: `No ${STAGING_DEPLOY_CONTEXT} status appeared within ${Math.round(a.graceMs / 60_000)} min — continuing without waiting for migrations` }
      : { action: 'wait' }
  }
  return a.elapsedMs >= a.timeoutMs
    ? { action: 'failed', reason: `The staging database migrations did not finish within ${Math.round(a.timeoutMs / 60_000)} min: ${STAGING_DEPLOY_CONTEXT} is still ${a.state}` }
    : { action: 'wait' }
}

export async function waitForStagingDeploy(
  repo: string, sha: string, token: string,
  opts: {
    timeoutMs?: number; graceMs?: number; intervalMs?: number; requestTimeoutMs?: number
    fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number
  } = {},
): Promise<{ ok: true; note: string | null } | { ok: false; reason: string }> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000
  const graceMs = opts.graceMs ?? 5 * 60_000
  const intervalMs = opts.intervalMs ?? 15_000
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const start = now()
  let seen: string | null = null, lastError = 'no answer yet'
  for (;;) {
    // 'ok' = the API answered; only then does a missing context mean "absent".
    let answered = false, state: string | null = null
    try {
      const res = await fetchFn(`https://api.github.com/repos/${repo}/commits/${sha}/status?per_page=100`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(opts.requestTimeoutMs ?? 10_000),
      })
      if (res.ok) {
        const body = (await res.json()) as { statuses?: Array<{ context?: string; state?: string }> }
        state = body.statuses?.find(s => s.context === STAGING_DEPLOY_CONTEXT)?.state ?? null
        answered = true
      } else if (res.status === 401 || res.status === 403 || res.status === 404) {
        lastError = `the GitHub API answered ${res.status} — check that the workflow token can read commit statuses (statuses: read)`
      } else lastError = `the GitHub API answered ${res.status}`
    } catch (e) { lastError = `the GitHub API was unreachable (${(e as Error).message})` }
    const elapsedMs = now() - start
    if (answered) {
      if (state) seen = state
      // Absent and never seen: the project has no Supabase deploy.
      const decision = decideStagingDeploy({ state: state ?? seen, elapsedMs, graceMs, timeoutMs })
      if (decision.action === 'done') return { ok: true, note: null }
      if (decision.action === 'continue') return { ok: true, note: decision.note }
      if (decision.action === 'failed') return { ok: false, reason: decision.reason }
    } else if (elapsedMs >= timeoutMs) {
      return { ok: false, reason: `Could not read ${STAGING_DEPLOY_CONTEXT} within ${Math.round(timeoutMs / 60_000)} min: ${lastError}` }
    }
    await sleep(intervalMs)
  }
}
