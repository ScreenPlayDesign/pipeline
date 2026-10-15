import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { notPerformedRow, postRehearsal, runPayload } from './post.ts'
import { png } from './pngFixture.ts'
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
    screenshot_url: null, video_url: null, diff_url: null, sort_order: 7, frames: [], comparisons: [],
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

test('without a token nothing is posted and the verdict is an error that says to run spd ci setup', async () => {
  const { calls, fetchFn } = stub(ok)
  const r = await postRehearsal({ ...env, SPD_API_TOKEN: undefined }, { fetchFn, cwd: project() })
  expect(r.verdict).toBe('error')
  expect(r.description).toBe('The rehearsal was not posted to the dashboard — run spd ci setup')
  expect(calls).toEqual([])
})

test('a missing api url or project slug is the same error', async () => {
  for (const drop of ['SPD_API_URL', 'SPD_PROJECT_SLUG'] as const) {
    const { calls, fetchFn } = stub(ok)
    const r = await postRehearsal({ ...env, [drop]: undefined }, { fetchFn, cwd: project() })
    expect(r.verdict).toBe('error')
    expect(r.description).toBe('The rehearsal was not posted to the dashboard — run spd ci setup')
    expect(calls).toEqual([])
  }
})

test('a network error is logged, fails the run, and makes the verdict an error', async () => {
  const { calls, fetchFn } = stub(() => { throw new Error('connection reset') })
  const r = await postRehearsal(env, { fetchFn, cwd: project() })
  expect(r).toEqual({ verdict: 'error', description: "The dashboard didn't store this rehearsal (connection reset) — see the run log" })
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
    expect(r).toEqual({ verdict: 'error', description: 'Staging was not ready — see the run log' })
    const body = calls.find(c => c.url.endsWith('/test-report'))!.body
    expect(body).toMatchObject({ status: 'failed', verdict: 'error', scenarios: [],
      metadata: { summary: 'Staging was not ready — see the run log' } })
  })
}

test('a wait reason from the workflow is the run description', async () => {
  const { fetchFn } = stub(ok)
  const r = await postRehearsal({ ...env, WAITED: 'failure', WAIT_REASON: 'The staging database migrations did not finish: supabase/staging-deploy is failure' }, { fetchFn, cwd: project() })
  expect(r.description).toBe('The staging database migrations did not finish: supabase/staging-deploy is failure')
})

for (const outcome of [undefined, '']) {
  test(`waited success with Playwright outcome ${JSON.stringify(outcome)} posts an error without reading any report`, async () => {
    const { calls, fetchFn } = stub(ok)
    const r = await postRehearsal({ ...env, WAITED: 'success', PLAYWRIGHT_OUTCOME: outcome }, { fetchFn, cwd: project() })
    expect(r).toEqual({ verdict: 'error', description: 'Playwright did not run — see the run log' })
    const body = calls.find(c => c.url.endsWith('/test-report'))!.body
    expect(body).toMatchObject({ status: 'failed', verdict: 'error', scenarios: [] })
  })
}

test('a failed cast reset posts an error that says so, without reading any report', async () => {
  const { calls, fetchFn } = stub(ok)
  const r = await postRehearsal({ ...env, WAITED: 'success', RESET_RESULT: 'failure', PLAYWRIGHT_OUTCOME: '' }, { fetchFn, cwd: project() })
  expect(r).toEqual({ verdict: 'error', description: 'The cast reset on staging failed — see the run log' })
  const body = calls.find(c => c.url.endsWith('/test-report'))!.body
  expect(body).toMatchObject({ status: 'failed', verdict: 'error', scenarios: [] })
})

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

test('with no posting token it prints a warning annotation and returns an error verdict', async () => {
  const logs: string[] = []
  const origLog = console.log, origWarn = console.warn
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
  console.warn = () => {}
  try {
    const { calls, fetchFn } = stub(ok)
    const { SPD_API_TOKEN: _drop, ...noToken } = env
    const r = await postRehearsal(noToken, { fetchFn, cwd: project() })
    expect(r.verdict).toBe('error')
    expect(calls).toEqual([])
  } finally { console.log = origLog; console.warn = origWarn }
  expect(logs).toContain('::warning::SPD_REHEARSAL_TOKEN is not set — the rehearsal was not posted to the dashboard (run spd ci setup)')
})

// A passing "Kira shares" whose Playwright screenshot is the blank page the
// scene never used, filmed on Kira's own browser over two steps.
function filmedScene(): string {
  const root = project()
  const art = join(root, 'review', 'artifacts', 'kira')
  mkdirSync(art, { recursive: true })
  const white = [255, 255, 255]
  writeFileSync(join(art, 'test-finished-1.png'), png([[white, white], [white, white]]))
  writeFileSync(join(art, 'video.webm'), 'webm')
  writeFileSync(join(root, 'review', 'results.json'), JSON.stringify({
    stats: { expected: 1, unexpected: 0, skipped: 0 },
    suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 'Kira shares', ok: true, tests: [{ results: [{
      status: 'passed', duration: 5, attachments: [
        { name: 'screenshot', contentType: 'image/png', path: join(art, 'test-finished-1.png') },
        { name: 'video', contentType: 'video/webm', path: join(art, 'video.webm') },
      ] }] }] }] }],
  }))
  const dir = join(root, 'review', 'walkthroughs', 'kira-shares')
  mkdirSync(dir, { recursive: true })
  for (const f of ['01-kira.png', '02-kira.png', '02-beth.png']) writeFileSync(join(dir, f), 'frame')
  const frame = (actor: string, file: string) => ({ actor_id: actor, file, url: 'https://staging/', width: 1, height: 1, captured_at: '', error: null })
  writeFileSync(join(dir, 'walkthrough.json'), JSON.stringify({
    actors: [{ id: 'kira', name: 'Kira', role: 'member' }, { id: 'beth', name: 'Beth', role: 'member' }],
    steps: [
      { index: 1, title: 'Given Kira is signed in', narration: '', focus_actor_id: 'kira', status: 'passed', error_message: null, frames: [frame('kira', '01-kira.png')] },
      { index: 2, title: 'When she shares', narration: '', focus_actor_id: 'beth', status: 'passed', error_message: null, frames: [frame('kira', '02-kira.png'), frame('beth', '02-beth.png')] },
    ],
  }))
  return root
}
const stored = (frames: number) => (url: string) => url.endsWith('/upload')
  ? new Response(JSON.stringify({ url: `https://store/${Math.random()}` }), { status: 201 })
  : new Response(JSON.stringify({ ok: true, frames_created: frames }), { status: 201 })

test("a blank page's screenshot and video are not posted; the final screen is the last step's focus frame", async () => {
  const { calls, fetchFn } = stub(stored(3))
  const r = await postRehearsal(env, { fetchFn, cwd: filmedScene() })
  expect(r.verdict).toBe('passed')
  const paths = calls.filter(c => c.url.endsWith('/upload')).map(c => String(c.body.path))
  expect(paths.some(p => p.endsWith('/screenshot.png') || p.endsWith('/video.webm'))).toBe(false)
  const sc = calls.find(c => c.url.endsWith('/test-report'))!.body.scenarios[0]
  expect(sc.video_url).toBeNull()
  const focus = sc.frames.find((f: any) => f.step_index === 2 && f.actor_id === 'beth')
  expect(sc.screenshot_url).toBe(focus.frame_url)
})

test('frames the dashboard did not store turn the verdict into an error', async () => {
  const { fetchFn } = stub(stored(0))
  const r = await postRehearsal(env, { fetchFn, cwd: filmedScene() })
  expect(r.verdict).toBe('error')
  expect(r.description).toContain('0 of 3 walkthrough frames')
  expect(process.exitCode).toBe(1)
})

test('a run the dashboard refused as an error is an error at the gate too', async () => {
  const { fetchFn } = stub(url => url.endsWith('/test-report')
    ? new Response(JSON.stringify({ error: 'walkthrough frames were not stored: permission denied', verdict: 'error' }), { status: 500 })
    : new Response(JSON.stringify({ url: 'https://store/x' }), { status: 201 }))
  const r = await postRehearsal(env, { fetchFn, cwd: filmedScene() })
  expect(r.verdict).toBe('error')
  expect(r.description).toContain('permission denied')
  expect(process.exitCode).toBe(1)
})

for (const status of [401, 502]) {
  test(`a ${status} from the dashboard makes the verdict an error even when local says passed`, async () => {
    const { fetchFn } = stub(url => url.endsWith('/test-report')
      ? new Response(status === 401 ? JSON.stringify({ error: 'unauthorized' }) : '<html>Bad Gateway</html>', { status })
      : ok())
    const r = await postRehearsal(env, { fetchFn, cwd: project() })
    expect(r.verdict).toBe('error')
    expect(r.description).toBe(status === 401
      ? "The dashboard didn't store this rehearsal (401: unauthorized) — see the run log"
      : "The dashboard didn't store this rehearsal (502) — see the run log")
    expect(process.exitCode).toBe(1)
  })
}

test('a long multi-line reason still gives a one-line description of at most 140 chars', async () => {
  const { fetchFn } = stub(url => url.endsWith('/test-report')
    ? new Response(JSON.stringify({ error: 'x'.repeat(300) + '\nsecond line' }), { status: 500 })
    : ok())
  const r = await postRehearsal(env, { fetchFn, cwd: project() })
  expect(r.verdict).toBe('error')
  expect(r.description.length).toBeLessThanOrEqual(140)
  expect(r.description).not.toContain('\n')
  expect(r.description.endsWith(') — see the run log')).toBe(true)
})

test('on a 2xx the verdict the dashboard recomputed wins over the local one', async () => {
  const { fetchFn } = stub(url => url.endsWith('/test-report')
    ? new Response(JSON.stringify({ ok: true, verdict: 'failed' }), { status: 201 })
    : ok())
  const r = await postRehearsal(env, { fetchFn, cwd: project() })
  expect(r.verdict).toBe('failed')
  expect(r.description).toBe('The dashboard counted this rehearsal as failed — see the run log')
})

// A failed "Kira shares" with Playwright's visual-comparison images.
function comparisonScene(files: string[], status: 'failed' | 'passed' = 'failed'): string {
  const root = project()
  mkdirSync(join(root, 'review', 'shots'), { recursive: true })
  const atts = files.map(f => {
    writeFileSync(join(root, 'review', 'shots', f), png([[[10, 20, 30], [40, 50, 60]]]))
    return { name: f, path: join(root, 'review', 'shots', f), contentType: 'image/png' }
  })
  writeFileSync(join(root, 'review', 'results.json'), JSON.stringify({
    stats: { expected: 0, unexpected: status === 'failed' ? 1 : 0, skipped: 0 },
    suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{
      title: 'Kira shares', ok: status === 'passed',
      tests: [{ annotations: [], results: [{ status, duration: 5, error: status === 'failed' ? { message: 'pixels differ' } : undefined, attachments: atts }] }],
    }] }],
  }))
  return root
}
const uploadsAsUrls = (url: string) => url.endsWith('/upload')
  ? new Response(JSON.stringify({ url: 'https://files.test/x' }), { status: 201 }) : ok()

test('a failed scene posts its expected, actual and diff images as one comparison', async () => {
  const root = comparisonScene(['kira-home-expected.png', 'kira-home-actual.png', 'kira-home-diff.png'])
  const { calls, fetchFn } = stub(url => url.endsWith('/upload')
    ? new Response(JSON.stringify({ url: 'https://files.test/' + calls.filter(c => c.url.endsWith('/upload')).length }), { status: 201 }) : ok())
  await postRehearsal(env, { fetchFn, cwd: root })
  const comps = calls.find(c => c.url.endsWith('/test-report'))!.body.scenarios[0].comparisons
  expect(comps).toHaveLength(1)
  expect(comps[0]).toMatchObject({ name: 'kira-home', step_index: null })
  for (const k of ['expected_url', 'actual_url', 'diff_url']) expect(comps[0][k]).toMatch(/^https:\/\/files\.test\//)
  expect(new Set([comps[0].expected_url, comps[0].actual_url, comps[0].diff_url]).size).toBe(3)
})

test('the comparison actor is the base-name segment that is a cast actor id', async () => {
  const root = comparisonScene(['three-actors-kira-expected.png', 'three-actors-kira-actual.png', 'three-actors-kira-diff.png'])
  mkdirSync(join(root, 'screenplay', 'personae', 'kira-pixel'), { recursive: true })
  writeFileSync(join(root, 'screenplay', 'personae', 'kira-pixel', 'account_settings.md'), '---\nname: Kira\nrole: host\n---\nKira hosts.')
  const { calls, fetchFn } = stub(uploadsAsUrls)
  await postRehearsal(env, { fetchFn, cwd: root })
  expect(calls.find(c => c.url.endsWith('/test-report'))!.body.scenarios[0].comparisons[0].actor).toBe('kira')
})

test('a comparison missing one of its three images is not posted', async () => {
  const root = comparisonScene(['kira-home-expected.png', 'kira-home-actual.png'])
  const { calls, fetchFn } = stub(uploadsAsUrls)
  await postRehearsal(env, { fetchFn, cwd: root })
  expect(calls.find(c => c.url.endsWith('/test-report'))!.body.scenarios[0].comparisons).toEqual([])
})

test('a passing scene posts no comparisons and uploads none', async () => {
  const root = comparisonScene(['kira-home-expected.png', 'kira-home-actual.png', 'kira-home-diff.png'], 'passed')
  const { calls, fetchFn } = stub(uploadsAsUrls)
  await postRehearsal(env, { fetchFn, cwd: root })
  expect(calls.find(c => c.url.endsWith('/test-report'))!.body.scenarios[0].comparisons).toEqual([])
})

test('comparison images outside review/ are not uploaded', async () => {
  const root = comparisonScene([])
  const out = ['kira-home-expected.png', 'kira-home-actual.png', 'kira-home-diff.png'].map(f => {
    writeFileSync(join(root, f), 'secret'); return { name: f, path: join(root, f), contentType: 'image/png' }
  })
  const rep = JSON.parse(require('node:fs').readFileSync(join(root, 'review', 'results.json'), 'utf8'))
  rep.suites[0].specs[0].tests[0].results[0].attachments = out
  writeFileSync(join(root, 'review', 'results.json'), JSON.stringify(rep))
  const { calls, fetchFn } = stub(uploadsAsUrls)
  await postRehearsal(env, { fetchFn, cwd: root })
  expect(calls.some(c => c.url.endsWith('/upload'))).toBe(false)
  expect(calls.find(c => c.url.endsWith('/test-report'))!.body.scenarios[0].comparisons).toEqual([])
})
