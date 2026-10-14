// scripts/rehearsal/buildInfo.ts — is staging serving this commit yet?
// The site's build-info.json carries the commit it was built from, often as
// a 7-character short sha.

export function servesCommit(info: unknown, sha: string): boolean {
  const served = (info as { sha?: unknown } | null)?.sha
  return typeof served === 'string' && served.length >= 7 && sha.startsWith(served)
}

export async function waitForBuild(
  siteUrl: string,
  sha: string,
  opts: {
    timeoutMs?: number; intervalMs?: number; fetchFn?: typeof fetch
    sleep?: (ms: number) => Promise<void>; now?: () => number
  } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000
  const intervalMs = opts.intervalMs ?? 15_000
  const fetchFn = opts.fetchFn ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const url = `${siteUrl.replace(/\/$/, '')}/build-info.json`
  const deadline = now() + timeoutMs
  let last = 'nothing yet'
  for (;;) {
    try {
      const res = await fetchFn(`${url}?t=${now()}`, { headers: { 'cache-control': 'no-cache' } })
      if (!res.ok) last = `build-info.json answered ${res.status}`
      else {
        const info = await res.json()
        if (servesCommit(info, sha)) return { ok: true }
        last = `staging serves ${String((info as { sha?: unknown }).sha ?? 'no sha')}`
      }
    } catch (e) {
      last = `build-info.json unreachable (${(e as Error).message})`
    }
    if (now() + intervalMs > deadline) {
      return { ok: false, reason: `staging never served ${sha.slice(0, 7)} within ${Math.round(timeoutMs / 60_000)} min — ${last}` }
    }
    await sleep(intervalMs)
  }
}
