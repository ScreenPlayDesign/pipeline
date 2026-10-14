import { describe, expect, test } from 'bun:test'
import { servesCommit, waitForBuild } from './buildInfo.ts'

const FULL = '9c9e9e2' + 'a'.repeat(33)

describe('servesCommit', () => {
  test('a short sha matches the full commit it abbreviates', () => {
    expect(servesCommit({ sha: '9c9e9e2' }, FULL)).toBe(true)
  })
  test('a full sha matches itself', () => {
    expect(servesCommit({ sha: FULL }, FULL)).toBe(true)
  })
  test('a different or missing sha does not', () => {
    expect(servesCommit({ sha: '1234567' }, FULL)).toBe(false)
    expect(servesCommit({ sha: '9c9' }, FULL)).toBe(false)   // too short to trust
    expect(servesCommit({}, FULL)).toBe(false)
    expect(servesCommit(null, FULL)).toBe(false)
  })
})

describe('waitForBuild', () => {
  const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms } } }
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  test('returns once staging serves the commit', async () => {
    const c = clock()
    let calls = 0
    const fetchFn = (async () => (++calls < 3 ? json({ sha: '1234567' }) : json({ sha: '9c9e9e2' }))) as unknown as typeof fetch
    const r = await waitForBuild('https://staging.x.pages.dev', FULL, { fetchFn, ...c, intervalMs: 15_000 })
    expect(r).toEqual({ ok: true })
    expect(calls).toBe(3)
  })

  test('gives up after the timeout, saying what it last saw', async () => {
    const c = clock()
    const fetchFn = (async () => json({ sha: '1234567' })) as unknown as typeof fetch
    const r = await waitForBuild('https://staging.x.pages.dev/', FULL, { fetchFn, ...c, timeoutMs: 60_000, intervalMs: 15_000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('1234567')
  })

  test('a site with no build-info.json says so', async () => {
    const c = clock()
    const fetchFn = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch
    const r = await waitForBuild('https://staging.x.pages.dev', FULL, { fetchFn, ...c, timeoutMs: 30_000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('build-info.json')
  })
})
