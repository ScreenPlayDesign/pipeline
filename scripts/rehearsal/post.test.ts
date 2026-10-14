import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { notPerformedRow, postRehearsal, runPayload } from './post.ts'
import type { ScenarioOutcome } from './verdict.ts'

const outcome: ScenarioOutcome = {
  scenario: { featureFile: 'screenplay/features/map.feature', name: 'Kira shares her map', tags: ['@cast'],
    steps: [{ keyword: 'Given', text: 'Kira is signed in' }, { keyword: 'When', text: 'she shares' }],
    required: true, isOutline: false },
  tests: [], outcome: 'not_performed',
}

test('a scenario with no test is posted as not performed, with its Gherkin', () => {
  expect(notPerformedRow(outcome, 7)).toEqual({
    feature_file: 'screenplay/features/map.feature', scenario_name: 'Kira shares her map', scenario_tags: ['@cast'],
    status: 'not_performed', required: true, duration_ms: null, error_message: 'This scene has no test yet',
    screenshot_url: null, video_url: null, diff_url: null, sort_order: 7, frames: [],
    steps: [
      { index: 1, keyword: 'Given', text: 'Kira is signed in', status: 'skipped', error: null, duration_ms: null, focus_actor: null },
      { index: 2, keyword: 'When', text: 'she shares', status: 'skipped', error: null, duration_ms: null, focus_actor: null },
    ],
  })
})

test('the run payload carries the verdict and counts as a dress rehearsal on staging', () => {
  const p = runPayload({
    slug: 'fastnacht-lancaster', sha: 'a'.repeat(40), description: '1/1 required scenes passed',
    verdict: { verdict: 'passed', requiredTotal: 1, requiredPassed: 1, failed: 0, notPerformed: 0, skipped: 0, laterTotal: 2 },
    scenarios: [], runUrl: 'https://github.com/x/actions/runs/1', runKey: '1', baseUrl: 'https://staging.x.pages.dev',
  })
  expect(p).toMatchObject({
    project_slug: 'fastnacht-lancaster', branch: 'staging', commit_sha: 'a'.repeat(40), status: 'passed',
    kind: 'dress_rehearsal', verdict: 'passed', required_total: 1, required_passed: 1, not_performed: 0, later_total: 2,
    triggered_by: 'dress-rehearsal', report_url: 'https://github.com/x/actions/runs/1',
    total_tests: 0, passed_tests: 0, failed_tests: 0,
  })
})

test('no report means verdict error and a failed run', () => {
  const p = runPayload({ slug: 's', sha: 'b'.repeat(40), verdict: null, description: 'Playwright produced no report',
    scenarios: [], runUrl: null, runKey: 'k', baseUrl: 'u' })
  expect(p).toMatchObject({ status: 'failed', verdict: 'error', required_total: null })
})

// --- postRehearsal: failure paths and the fixme row ---------------------

const dirs: string[] = []
afterEach(() => {
  process.exitCode = 0
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function project(opts: { report?: 'pass' | 'fixme' | 'none' | 'garbage' | 'laterFailure' } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'rehearsal-post-'))
  dirs.push(root)
  mkdirSync(join(root, 'screenplay', 'features'), { recursive: true })
  const kind = opts.report ?? 'pass'
  writeFileSync(join(root, 'screenplay', 'features', 'a.feature'), kind === 'laterFailure'
    ? 'Feature: A\n  Scenario: Kira shares\n    Given Kira is signed in\n    When she shares\n'
      + '  @later\n  Scenario: Kira exports\n    Given Kira is signed in\n'
    : 'Feature: A\n  Scenario: Kira shares\n    Given Kira is signed in\n    When she shares\n')
  if (kind !== 'none') {
    mkdirSync(join(root, 'review'), { recursive: true })
    const annotations = kind === 'fixme' ? [{ type: 'fixme' }] : []
    const shares = {
      title: 'Kira shares', ok: true,
      tests: [{ annotations, results: [{ status: kind === 'fixme' ? 'skipped' : 'passed', duration: 5, attachments: [] }] }],
    }
    const exports = {
      title: 'Kira exports @later', ok: false,
      tests: [{ results: [{ status: 'failed', duration: 3, error: { message: 'boom' }, attachments: [] }] }],
    }
    const report = kind === 'laterFailure'
      ? { stats: { expected: 1, unexpected: 1, skipped: 0 },
          suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [shares, exports] }] }
      : { stats: { expected: 1, unexpected: 0, skipped: 0 },
          suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [shares] }] }
    writeFileSync(join(root, 'review', 'results.json'), kind === 'garbage' ? '{not json' : JSON.stringify(report))
  }
  return root
}

const env = { SPD_API_TOKEN: 't', SPD_API_URL: 'https://api.test', SPD_PROJECT_SLUG: 'p', GITHUB_SHA: 'c'.repeat(40) }

function stub(respond: (url: string) => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: any }> = []
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
    return respond(url)
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}
const ok = () => new Response('{}', { status: 201 })

test('without a token nothing is posted but the verdict is still returned', async () => {
  const { calls, fetchFn } = stub(ok)
  const r = await postRehearsal({ ...env, SPD_API_TOKEN: undefined }, { fetchFn, cwd: project() })
  expect(r.verdict).toBe('passed')
  expect(calls).toEqual([])
})

test('a network error is logged, fails the run, and still returns the verdict', async () => {
  const { calls, fetchFn } = stub(() => { throw new Error('connection reset') })
  const r = await postRehearsal(env, { fetchFn, cwd: project() })
  expect(r.verdict).toBe('passed')
  expect(process.exitCode).toBe(1)
  expect(calls.map(c => c.url)).toEqual(['https://api.test/screenplay-report', 'https://api.test/test-report'])
})

test('a rejected screenplay still posts the test report, and the run fails', async () => {
  const { calls, fetchFn } = stub(url => url.endsWith('/screenplay-report') ? new Response('no', { status: 500 }) : ok())
  const r = await postRehearsal(env, { fetchFn, cwd: project() })
  expect(r.verdict).toBe('passed')
  expect(process.exitCode).toBe(1)
  expect(calls.some(c => c.url.endsWith('/test-report'))).toBe(true)
})

test('no results.json posts verdict error and a failed run', async () => {
  const { calls, fetchFn } = stub(ok)
  const r = await postRehearsal(env, { fetchFn, cwd: project({ report: 'none' }) })
  expect(r.verdict).toBe('error')
  const body = calls.find(c => c.url.endsWith('/test-report'))!.body
  expect(body).toMatchObject({ status: 'failed', verdict: 'error' })
  expect(process.exitCode).toBe(0)
})

test('an unparseable results.json is warned about and treated as no report', async () => {
  const warnings: string[] = []
  const orig = console.warn
  console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')) }
  try {
    const { fetchFn } = stub(ok)
    const r = await postRehearsal(env, { fetchFn, cwd: project({ report: 'garbage' }) })
    expect(r.verdict).toBe('error')
  } finally { console.warn = orig }
  expect(warnings.some(w => w.includes('could not be parsed'))).toBe(true)
})

test('a fixme test is posted as not performed with the scene steps and a reason', async () => {
  const { calls, fetchFn } = stub(ok)
  await postRehearsal(env, { fetchFn, cwd: project({ report: 'fixme' }) })
  const row = calls.find(c => c.url.endsWith('/test-report'))!.body.scenarios[0]
  expect(row).toMatchObject({ status: 'not_performed', error_message: "This scene's test is marked fixme" })
  expect(row.steps).toEqual([
    { index: 1, keyword: 'Given', text: 'Kira is signed in', status: 'skipped', error: null, duration_ms: null, focus_actor: null },
    { index: 2, keyword: 'When', text: 'she shares', status: 'skipped', error: null, duration_ms: null, focus_actor: null },
  ])
})

test('Playwright crashed after recording only passes: the verdict is error, not passed', async () => {
  const { calls, fetchFn } = stub(ok)
  const r = await postRehearsal({ ...env, PLAYWRIGHT_OUTCOME: 'failure' }, { fetchFn, cwd: project() })
  expect(r).toEqual({ verdict: 'error', description: 'Playwright exited with an error but recorded no failing scene — see the run log' })
  const body = calls.find(c => c.url.endsWith('/test-report'))!.body
  expect(body).toMatchObject({ status: 'failed', verdict: 'error' })
})

test('a failing @later scene makes Playwright exit non-zero but does not block the verdict', async () => {
  const { calls, fetchFn } = stub(ok)
  const r = await postRehearsal({ ...env, PLAYWRIGHT_OUTCOME: 'failure' }, { fetchFn, cwd: project({ report: 'laterFailure' }) })
  expect(r.verdict).toBe('passed')
  const body = calls.find(c => c.url.endsWith('/test-report'))!.body
  expect(body).toMatchObject({ status: 'passed', verdict: 'passed', later_total: 1 })
})

test('passed and failed counts cover only required scenes, so a failing @later scene is not shown as a failure', () => {
  const row = (status: 'passed' | 'failed', required: boolean) => ({ ...notPerformedRow(outcome, 0), status, required })
  const p = runPayload({
    slug: 's', sha: 'a'.repeat(40), description: '1/1 required scenes passed',
    verdict: { verdict: 'passed', requiredTotal: 1, requiredPassed: 1, failed: 0, notPerformed: 0, skipped: 0, laterTotal: 2 },
    scenarios: [row('passed', true), row('failed', false), row('passed', false)],
    runUrl: null, runKey: 'k', baseUrl: 'u',
  })
  expect(p).toMatchObject({ total_tests: 3, passed_tests: 1, failed_tests: 0 })
})

for (const waited of ['failure', 'cancelled']) {
  test(`staging wait ${waited} posts the run as error with the reason, without reading any report`, async () => {
    const { calls, fetchFn } = stub(ok)
    const r = await postRehearsal({ ...env, WAITED: waited, PLAYWRIGHT_OUTCOME: 'skipped' }, { fetchFn, cwd: project() })
    expect(r).toEqual({ verdict: 'error', description: 'Staging never served this commit within 15 minutes' })
    const body = calls.find(c => c.url.endsWith('/test-report'))!.body
    expect(body).toMatchObject({ status: 'failed', verdict: 'error', scenarios: [],
      metadata: { summary: 'Staging never served this commit within 15 minutes' } })
  })
}

for (const outcome of ['skipped', 'cancelled']) {
  test(`Playwright ${outcome} is an error even when an old results.json is present`, async () => {
    const { calls, fetchFn } = stub(ok)
    const r = await postRehearsal({ ...env, PLAYWRIGHT_OUTCOME: outcome }, { fetchFn, cwd: project() })
    expect(r).toEqual({ verdict: 'error', description: 'Playwright did not run — see the run log' })
    const body = calls.find(c => c.url.endsWith('/test-report'))!.body
    expect(body).toMatchObject({ status: 'failed', verdict: 'error' })
  })
}

test('a walkthrough frame pointing outside review/ is not uploaded, and the run still posts', async () => {
  const root = project()
  writeFileSync(join(root, 'outside.png'), 'secret')
  const dir = join(root, 'review', 'walkthroughs', 'kira-shares')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'walkthrough.json'), JSON.stringify({
    actors: [{ id: 'kira', name: 'Kira', role: 'member' }],
    steps: [{
      index: 1, title: 'Given Kira is signed in', narration: '', focus_actor_id: 'kira', status: 'passed', error_message: null,
      frames: [{ actor_id: 'kira', file: '../../../outside.png', url: 'https://x', width: 1, height: 1, captured_at: '', error: null }],
    }],
  }))
  const { calls, fetchFn } = stub(ok)
  const r = await postRehearsal(env, { fetchFn, cwd: root })
  expect(r.verdict).toBe('passed')
  expect(calls.some(c => c.url.endsWith('/upload') && String(c.body.path).includes('outside.png'))).toBe(false)
  const body = calls.find(c => c.url.endsWith('/test-report'))!.body
  expect(body.scenarios[0].frames).toEqual([])
})

test('an empty SPD_REHEARSAL_TOKEN falls back to SPD_API_TOKEN', async () => {
  const seen: string[] = []
  const fetchFn = (async (_u: string, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>).Authorization); return ok()
  }) as unknown as typeof fetch
  await postRehearsal({ ...env, SPD_API_TOKEN: 'api-tok', SPD_REHEARSAL_TOKEN: '' }, { fetchFn, cwd: project() })
  expect(seen.length).toBeGreaterThan(0)
  expect(new Set(seen)).toEqual(new Set(['Bearer api-tok']))
})

test('the rehearsal token wins when both tokens are set', async () => {
  const seen: string[] = []
  const fetchFn = (async (_u: string, init?: RequestInit) => {
    seen.push((init?.headers as Record<string, string>).Authorization); return ok()
  }) as unknown as typeof fetch
  await postRehearsal({ ...env, SPD_API_TOKEN: 'api-tok', SPD_REHEARSAL_TOKEN: 'reh-tok' }, { fetchFn, cwd: project() })
  expect(new Set(seen)).toEqual(new Set(['Bearer reh-tok']))
})

function reportWith(attachments: unknown[]) {
  return JSON.stringify({
    stats: { expected: 1, unexpected: 0, skipped: 0 },
    suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{
      title: 'Kira shares', ok: true,
      tests: [{ annotations: [], results: [{ status: 'passed', duration: 5, attachments }] }],
    }] }],
  })
}

test('a Playwright attachment outside review/ is not uploaded', async () => {
  const root = project()
  writeFileSync(join(root, 'outside.png'), 'secret')
  writeFileSync(join(root, 'review', 'results.json'),
    reportWith([{ name: 'screenshot', path: join(root, 'outside.png'), contentType: 'image/png' }]))
  const { calls, fetchFn } = stub(ok)
  const r = await postRehearsal(env, { fetchFn, cwd: root })
  expect(r.verdict).toBe('passed')
  expect(calls.some(c => c.url.endsWith('/upload'))).toBe(false)
  expect(calls.find(c => c.url.endsWith('/test-report'))!.body.scenarios[0].screenshot_url).toBeNull()
})

test('a results.json that is a symlink to a file outside review/ is treated as no report', async () => {
  const root = project()
  writeFileSync(join(root, 'real.json'), reportWith([]))
  rmSync(join(root, 'review', 'results.json'))
  symlinkSync(join(root, 'real.json'), join(root, 'review', 'results.json'))
  const { fetchFn } = stub(ok)
  const r = await postRehearsal(env, { fetchFn, cwd: root })
  expect(r.verdict).toBe('error')
})
