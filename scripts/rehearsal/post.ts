// scripts/rehearsal/post.ts — post a staging dress rehearsal to the dashboard:
// the screenplay (cast, setting, scenes), every scenario's result with its
// evidence, and the gate verdict. The evidence upload follows
// foundation-template/scripts/post-spd-results.ts.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { projectRoot } from './config.ts'
import { insideAny } from './paths.ts'
import { isBlankPng } from './png.ts'
import { collectCastEntries } from './screenplay.ts'
import { finalResult, runTestsFrom, slugify, splitKeyword, stripAnsi, type PlaywrightReport, type ReportTest } from './report.ts'
import { inventoryFrom, matchScenarios, summaryLine, verdictOf, type ScenarioOutcome, type Verdict } from './verdict.ts'

interface StepRow { index: number; keyword: string; text: string; status: 'passed' | 'failed' | 'skipped'; error: string | null; duration_ms: number | null; focus_actor: string | null }
interface FrameRow {
  step_index: number; step_title: string; narration: string | null; step_status: 'passed' | 'failed' | 'skipped'
  actor_id: string; actor_name: string; actor_role: string | null; actor_device: string | null
  is_focus: boolean; frame_url: string; content_hash: string | null; page_url: string | null
  width: number | null; height: number | null; captured_at: string | null
}
export interface ComparisonRow {
  name: string; step_index: number | null; actor: string | null
  expected_url: string; actual_url: string; diff_url: string
}
export interface ScenarioRow {
  feature_file: string; scenario_name: string; scenario_tags: string[]
  status: 'passed' | 'failed' | 'skipped' | 'not_performed'
  required: boolean; duration_ms: number | null; error_message: string | null
  screenshot_url: string | null; video_url: string | null; diff_url: string | null
  sort_order: number; frames: FrameRow[]; steps: StepRow[]; comparisons: ComparisonRow[]
}
interface WalkthroughManifest {
  actors: Array<{ id: string; name: string; role: string; device?: string }>
  steps: Array<{
    index: number; title: string; narration: string; focus_actor_id: string | null
    status: 'passed' | 'failed'; error_message: string | null; duration_ms?: number | null
    frames: Array<{ actor_id: string; file: string; url: string; width: number | null; height: number | null; captured_at: string; error: string | null }>
  }>
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.svg': 'image/svg+xml',
}

function skippedSteps(o: ScenarioOutcome): StepRow[] {
  return o.scenario.steps.map((s, i) => ({
    index: i + 1, keyword: s.keyword, text: s.text, status: 'skipped', error: null, duration_ms: null, focus_actor: null,
  }))
}

export function notPerformedRow(o: ScenarioOutcome, sortOrder: number): ScenarioRow {
  return {
    feature_file: o.scenario.featureFile, scenario_name: o.scenario.name, scenario_tags: o.scenario.tags,
    status: 'not_performed', required: o.scenario.required, duration_ms: null,
    error_message: 'This scene has no test yet',
    screenshot_url: null, video_url: null, diff_url: null, sort_order: sortOrder, frames: [], comparisons: [],
    steps: skippedSteps(o),
  }
}

const COMPARISON_SUFFIX = /-(expected|actual|diff)\.png$/

/** Playwright's visual-comparison images grouped by base name (the file name without the suffix). */
export function groupComparisonImages(
  atts: Array<{ name?: string; path?: string }>,
): Array<{ name: string; files: Partial<Record<'expected' | 'actual' | 'diff', string>> }> {
  const groups = new Map<string, Partial<Record<'expected' | 'actual' | 'diff', string>>>()
  for (const a of atts) {
    if (!a.path) continue
    const m = COMPARISON_SUFFIX.exec(basename(a.path))
    if (!m) continue
    const name = basename(a.path).slice(0, m.index)
    groups.set(name, { ...groups.get(name), [m[1]]: a.path })
  }
  return [...groups].map(([name, files]) => ({ name, files }))
}

/** The cast actor a comparison is about: a '-'-separated segment of its name that is an actor id. */
export function comparisonActor(name: string, actorIds: Set<string>): string | null {
  return name.toLowerCase().split('-').find(seg => actorIds.has(seg)) ?? null
}

export function runPayload(a: {
  slug: string; sha: string; verdict: Verdict | null; description: string
  scenarios: ScenarioRow[]; runUrl: string | null; runKey: string; baseUrl: string
}): Record<string, unknown> {
  const v = a.verdict
  return {
    project_slug: a.slug, branch: 'staging', commit_sha: a.sha,
    status: v?.verdict === 'passed' ? 'passed' : 'failed',
    kind: 'dress_rehearsal', verdict: v?.verdict ?? 'error',
    required_total: v?.requiredTotal ?? null, required_passed: v?.requiredPassed ?? null,
    not_performed: v?.notPerformed ?? null, later_total: v?.laterTotal ?? null,
    total_tests: a.scenarios.length,
    passed_tests: a.scenarios.filter(s => s.required && s.status === 'passed').length,
    failed_tests: a.scenarios.filter(s => s.required && s.status === 'failed').length,
    triggered_by: 'dress-rehearsal', runner_name: 'github-actions', report_url: a.runUrl,
    metadata: { run_key: a.runKey, base_url: a.baseUrl, summary: a.description },
    scenarios: a.scenarios,
  }
}

export async function postRehearsal(
  env: NodeJS.ProcessEnv = process.env,
  deps: { fetchFn?: typeof fetch; cwd?: string } = {},
): Promise<{ verdict: 'passed' | 'failed' | 'error'; description: string }> {
  const root = deps.cwd ?? projectRoot(env)
  const fetchFn = deps.fetchFn ?? fetch
  // The SPD_API_TOKEN fallback is for local runs only; the workflow never passes it.
  const token = env.SPD_REHEARSAL_TOKEN || env.SPD_API_TOKEN, apiUrl = env.SPD_API_URL?.replace(/\/$/, ''), slug = env.SPD_PROJECT_SLUG
  const sha = env.GITHUB_SHA ?? '', runKey = env.GITHUB_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-')
  const evidenceRoots = [join(root, 'review'), join(root, 'screenplay')]
  const resultsFile = join(root, 'review', 'results.json')
  const walkDir = join(root, 'review', 'walkthroughs')

  const entries = collectCastEntries(join(root, 'screenplay'))
  const inventory = inventoryFrom(entries)

  // Staging never served this commit: nothing was performed, so no report is
  // read (any results.json is stale) and the run is posted as an error.
  const neverServed = env.WAITED !== undefined && env.WAITED !== 'success'
  // Staging was served but Playwright never reported an outcome (the perform
  // job did not reach it): likewise nothing this run produced can be trusted.
  const notPerformed = !neverServed && env.WAITED === 'success' && !env.PLAYWRIGHT_OUTCOME
  let report: PlaywrightReport | null = null
  try { if (!neverServed && !notPerformed && existsSync(resultsFile)) {
      if (!insideAny(evidenceRoots, resultsFile)) throw new Error('refused: results.json is not a regular file under review/')
      report = JSON.parse(readFileSync(resultsFile, 'utf8'))
    }
  } catch {
    console.warn(`  ${resultsFile} could not be parsed — treating the rehearsal as having no report`)
    report = null
  }

  let verdict: Verdict | null = null
  let description = 'Playwright produced no report'
  let outcomes: ScenarioOutcome[] = []
  let tests: ReportTest[] = []
  if (report?.suites) {
    tests = runTestsFrom(report)
    const m = matchScenarios(inventory, tests)
    outcomes = m.outcomes
    verdict = verdictOf(outcomes)
    description = summaryLine(verdict)
    for (const o of m.orphans) console.warn(`  test with no scenario: ${o.featureFile} :: ${o.title}`)
  }
  // Playwright exits non-zero for a failing @later scene too, so only a
  // non-zero exit with no failing test at all means the run itself crashed
  // (its partial report then looks like a pass).
  if (env.PLAYWRIGHT_OUTCOME === 'failure' && report && (report.stats?.unexpected ?? 0) === 0) {
    verdict = null
    description = 'Playwright exited with an error but recorded no failing scene — see the run log'
  }
  // Playwright skipped or cancelled: whatever results.json exists is not this run's.
  if (notPerformed || (env.PLAYWRIGHT_OUTCOME && env.PLAYWRIGHT_OUTCOME !== 'success' && env.PLAYWRIGHT_OUTCOME !== 'failure')) {
    verdict = null; outcomes = []; tests = []
    description = notPerformed && env.RESET_RESULT === 'failure'
      ? 'The cast reset on staging failed — see the run log'
      : 'Playwright did not run — see the run log'
  }
  if (neverServed) {
    verdict = null; outcomes = []; tests = []
    description = env.WAIT_REASON || 'Staging was not ready — see the run log'
  }
  const result = { verdict: (verdict?.verdict ?? 'error') as 'passed' | 'failed' | 'error', description }

  if (!token) {
    console.log('::warning::SPD_REHEARSAL_TOKEN is not set — the rehearsal was not posted to the dashboard (run spd ci setup)')
  }
  if (!token || !apiUrl || !slug) {
    console.warn('SPD_REHEARSAL_TOKEN, SPD_API_URL or SPD_PROJECT_SLUG missing — not posting to the dashboard')
    // A gate that posted nothing must not go green on the local verdict.
    return { verdict: 'error', description: 'The rehearsal was not posted to the dashboard — run spd ci setup' }
  }
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  async function upload(localPath: string, remotePath: string, key = runKey): Promise<string | null> {
    if (!localPath || !existsSync(localPath)) return null
    if (!insideAny(evidenceRoots, localPath)) {
      console.warn(`  refused evidence outside review/ or screenplay/: ${remotePath}`)
      return null
    }
    const size = statSync(localPath).size
    if (size === 0 || size > 40 * 1024 * 1024) return null
    try {
      const res = await fetchFn(`${apiUrl}/upload`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          project_slug: slug, run_key: key, path: remotePath,
          content_type: MIME[extname(localPath).toLowerCase()] ?? 'application/octet-stream',
          data_b64: readFileSync(localPath).toString('base64'),
        }),
      })
      if (!res.ok) { console.warn(`  upload ${remotePath}: ${res.status}`); return null }
      return ((await res.json()) as { url?: string }).url ?? null
    } catch (e) { console.warn(`  upload ${remotePath}: ${(e as Error).message}`); return null }
  }

  // 1. The screenplay itself (what Pete reads, even for scenes with no test).
  try {
    for (const e of entries) if (e.avatar_path) e.avatar_url = await upload(e.avatar_path, `${e.actor_key}.svg`, 'personae')
    const screenplayRes = await fetchFn(`${apiUrl}/screenplay-report`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ project_slug: slug, entries: entries.map(({ avatar_path: _, ...rest }) => rest) }),
    })
    if (!screenplayRes.ok) {
      console.error(`✗ screenplay-report ${screenplayRes.status}`)
      process.exitCode = 1
    }
  } catch (e) {
    console.error(`✗ screenplay-report failed: ${(e as Error).message}`)
    process.exitCode = 1
  }

  // 2. Every scenario: performed ones with their evidence, the rest as not performed.
  let framesSent = 0
  const scenarioOf = new Map<ReportTest, ScenarioOutcome>()
  for (const o of outcomes) for (const t of o.tests) scenarioOf.set(t as ReportTest, o)
  const rows: ScenarioRow[] = []
  const castIds = new Set(entries.filter(e => e.kind === 'persona').flatMap(e => e.actor_key ? [e.actor_key.toLowerCase()] : []))
  for (const t of tests) {
    const o = scenarioOf.get(t)
    const r = finalResult(t.spec)
    const status: ScenarioRow['status'] = t.status === 'fixme' ? 'not_performed' : t.status
    const sSlug = slugify(t.rawTitle)
    const atts = r?.attachments ?? []
    let screenshot: string | null = null, video: string | null = null, diff: string | null = null
    if (status === 'passed' || status === 'failed') {
      const shot = atts.find(a => a.name === 'screenshot' && a.path) ?? atts.find(a => a.contentType?.startsWith('image/') && a.path && !/-(expected|diff)\./.test(a.path))
      const vid = atts.find(a => a.name === 'video' && a.path)
      const dif = atts.find(a => a.path && /-diff\.png$/.test(a.path))
      // A scene performed on its actors' own browsers leaves the test's own
      // page blank; its screenshot and video would show Pete an empty screen.
      const unusedPage = !!shot?.path && insideAny(evidenceRoots, shot.path) && isBlankPng(shot.path)
      if (shot?.path && !unusedPage) screenshot = await upload(shot.path, `${sSlug}/screenshot${extname(shot.path)}`)
      if (vid?.path && !unusedPage) video = await upload(vid.path, `${sSlug}/video${extname(vid.path)}`)
      if (dif?.path) diff = await upload(dif.path, `${sSlug}/diff.png`)
    }
    const comparisons: ComparisonRow[] = []
    if (status === 'failed') {
      for (const g of groupComparisonImages(atts)) {
        const { expected, actual, diff: dif } = g.files
        if (!expected || !actual || !dif) continue
        const [expected_url, actual_url, diff_url] = [
          await upload(expected, `${sSlug}/comparison/${g.name}-expected.png`),
          await upload(actual, `${sSlug}/comparison/${g.name}-actual.png`),
          await upload(dif, `${sSlug}/comparison/${g.name}-diff.png`),
        ]
        if (!expected_url || !actual_url || !diff_url) continue
        // step_index stays null: Playwright's image names do not say which step they belong to.
        comparisons.push({ name: g.name, step_index: null, actor: comparisonActor(g.name, castIds), expected_url, actual_url, diff_url })
      }
    }
    const frames: FrameRow[] = []
    let steps: StepRow[] = []
    const manifestPath = join(walkDir, sSlug, 'walkthrough.json')
    if ((status === 'passed' || status === 'failed') && existsSync(manifestPath) && insideAny(evidenceRoots, manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as WalkthroughManifest
        steps = m.steps.map(s => ({
          index: s.index, ...splitKeyword(s.title), status: s.status,
          error: s.status === 'failed' ? stripAnsi(r?.error?.message ?? s.error_message ?? '') || null : null,
          duration_ms: s.duration_ms ?? null, focus_actor: s.focus_actor_id,
        }))
        const actorById = new Map(m.actors.map(a => [a.id, a]))
        for (const step of m.steps) for (const fr of step.frames) {
          if (fr.error) continue
          const local = join(walkDir, sSlug, fr.file)
          const url = await upload(local, `${sSlug}/frames/${basename(fr.file)}`)
          if (!url) continue
          const actor = actorById.get(fr.actor_id)
          frames.push({
            step_index: step.index, step_title: step.title,
            narration: step.narration && step.narration !== step.title ? step.narration : null,
            step_status: step.status, actor_id: fr.actor_id, actor_name: actor?.name ?? fr.actor_id,
            actor_role: actor?.role ?? null, actor_device: actor?.device ?? null,
            is_focus: step.focus_actor_id === fr.actor_id, frame_url: url,
            content_hash: (() => { try { return createHash('sha256').update(readFileSync(local)).digest('hex') } catch { return null } })(),
            page_url: fr.url ?? null, width: fr.width, height: fr.height, captured_at: fr.captured_at ?? null,
          })
        }
      } catch (e) { console.warn(`  walkthrough ${sSlug}: ${(e as Error).message}`) }
    }
    // With no screenshot of its own, the scene's final screen is the last
    // step's frame of the actor that step is about.
    if (!screenshot && frames.length) {
      const lastStep = frames[frames.length - 1].step_index
      const last = frames.filter(f => f.step_index === lastStep)
      screenshot = (last.find(f => f.is_focus) ?? last[0]).frame_url
    }
    framesSent += frames.length
    const fixmeScene = t.status === 'fixme' && o ? o : null
    rows.push({
      feature_file: t.featureFile, scenario_name: t.title,
      scenario_tags: o?.scenario.tags ?? [], status, required: o?.scenario.required ?? false,
      duration_ms: r?.duration ?? null,
      error_message: fixmeScene ? "This scene's test is marked fixme"
        : r?.error?.message ? stripAnsi(r.error.message).split('\n')[0] : null,
      screenshot_url: screenshot, video_url: video, diff_url: diff,
      sort_order: rows.length, frames, comparisons, steps: fixmeScene ? skippedSteps(fixmeScene) : steps,
    })
  }
  for (const o of outcomes.filter(x => x.tests.length === 0)) rows.push(notPerformedRow(o, rows.length))

  try {
    const res = await fetchFn(`${apiUrl}/test-report`, {
      method: 'POST', headers: auth,
      body: JSON.stringify(runPayload({
        slug, sha, verdict, description, scenarios: rows,
        runUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
          ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
        runKey, baseUrl: env.BASE_URL ?? '',
      })),
    })
    const text = await res.text()
    let stored: { verdict?: string; error?: string; frames_created?: number } = {}
    try { stored = JSON.parse(text) } catch { /* not JSON: reported below as text */ }
    if (!res.ok) {
      console.error(`✗ test-report ${res.status}: ${text.slice(0, 300)}`)
      process.exitCode = 1
      // Whatever the dashboard did not store, Pete cannot review: the gate
      // must say so, not pass on the local verdict.
      Object.assign(result, notStored(stored.error ? `${res.status}: ${stored.error}` : String(res.status)))
    } else if (framesSent > 0 && typeof stored.frames_created === 'number' && stored.frames_created < framesSent) {
      console.error(`✗ the dashboard stored ${stored.frames_created} of ${framesSent} walkthrough frames`)
      process.exitCode = 1
      result.verdict = 'error'
      result.description = `The dashboard stored ${stored.frames_created} of ${framesSent} walkthrough frames — see the run log`
    } else {
      // The server recomputes the verdict from what it stored; it decides.
      if (stored.verdict === 'passed' || stored.verdict === 'failed' || stored.verdict === 'error') {
        if (stored.verdict !== result.verdict) {
          result.description = `The dashboard counted this rehearsal as ${stored.verdict} — see the run log`
        }
        result.verdict = stored.verdict
      }
      console.log(`✓ posted ${rows.length} scenario row(s) — ${result.description}`)
    }
  } catch (e) {
    console.error(`✗ test-report failed: ${(e as Error).message}`)
    process.exitCode = 1
    Object.assign(result, notStored((e as Error).message))
  }
  return result
}

/** The gate result when the dashboard did not store the run: one line, ≤140 chars. */
export function notStored(reason: string): { verdict: 'error'; description: string } {
  const head = "The dashboard didn't store this rehearsal ("
  const tail = ') — see the run log'
  let why = reason.replace(/\s+/g, ' ').trim() || 'no reason given'
  const room = 140 - head.length - tail.length
  if (why.length > room) why = why.slice(0, room - 1) + '…'
  return { verdict: 'error', description: head + why + tail }
}
