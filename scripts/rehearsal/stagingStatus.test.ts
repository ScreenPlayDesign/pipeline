import { expect, test } from 'bun:test'
import { decideStagingDeploy, waitForStagingDeploy } from './stagingStatus.ts'

const GRACE = 5 * 60_000, LIMIT = 15 * 60_000
const d = (state: string | null, elapsedMs: number) => decideStagingDeploy({ state, elapsedMs, graceMs: GRACE, timeoutMs: LIMIT })

test('success is done', () => expect(d('success', 0)).toEqual({ action: 'done' }))
test('failure and error stop with a clear message', () => {
  for (const s of ['failure', 'error']) {
    const r = d(s, 10)
    expect(r.action).toBe('failed')
    expect((r as { reason: string }).reason).toContain('supabase/staging-deploy')
    expect((r as { reason: string }).reason).toContain(s)
  }
})
test('pending keeps waiting until the timeout, then fails', () => {
  expect(d('pending', GRACE + 1).action).toBe('wait')
  expect(d('pending', LIMIT).action).toBe('failed')
})
test('an absent status keeps waiting during the grace period, then continues', () => {
  expect(d(null, GRACE - 1).action).toBe('wait')
  expect(d(null, GRACE)).toMatchObject({ action: 'continue' })
})

function api(states: Array<string | null>) {
  const urls: string[] = []
  let i = 0
  const fetchFn = (async (url: string) => {
    urls.push(url)
    const s = states[Math.min(i++, states.length - 1)]
    return new Response(JSON.stringify({ statuses: s ? [{ context: 'other', state: 'failure' }, { context: 'supabase/staging-deploy', state: s }] : [{ context: 'other', state: 'failure' }] }))
  }) as unknown as typeof fetch
  return { urls, fetchFn }
}
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => { t += ms } }
}

test('waits for pending to turn success, reading the commit status of the sha', async () => {
  const { urls, fetchFn } = api(['pending', 'pending', 'success'])
  const r = await waitForStagingDeploy('o/r', 'abc', 'tok', { fetchFn, ...clock() })
  expect(r).toEqual({ ok: true, note: null })
  expect(urls[0]).toBe('https://api.github.com/repos/o/r/commits/abc/status')
})
test('a failed deploy status is not ok', async () => {
  const r = await waitForStagingDeploy('o/r', 'abc', 'tok', { fetchFn: api(['pending', 'failure']).fetchFn, ...clock() })
  expect(r.ok).toBe(false)
})
test('a project that never posts the status continues after the grace period, with a note', async () => {
  const r = await waitForStagingDeploy('o/r', 'abc', 'tok', { fetchFn: api([null]).fetchFn, ...clock() })
  expect(r.ok).toBe(true)
  expect((r as { note: string }).note).toContain('supabase/staging-deploy')
})
test('an API error is treated like an absent status, not a failure', async () => {
  const fetchFn = (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch
  const r = await waitForStagingDeploy('o/r', 'abc', 'tok', { fetchFn, ...clock() })
  expect(r.ok).toBe(true)
})
