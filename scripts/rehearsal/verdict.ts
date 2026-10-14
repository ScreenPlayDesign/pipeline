// scripts/rehearsal/verdict.ts — which scenarios were performed, and is the
// rehearsal green? Matching follows check:scenes and the dashboard: a
// scenario matches the test with the same title (tags ignored) in the spec
// paired with its feature file; an outline matches every example's test.
import type { CastEntry, ScriptStep } from './screenplay.ts'

export const LATER_TAG = '@later'

export interface InventoryScenario {
  featureFile: string; name: string; tags: string[]; steps: ScriptStep[]
  required: boolean; isOutline: boolean
}

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'fixme'
export interface RunTest { featureFile: string; title: string; status: TestStatus }

export type Outcome = 'passed' | 'failed' | 'skipped' | 'not_performed'
export interface ScenarioOutcome { scenario: InventoryScenario; tests: RunTest[]; outcome: Outcome }

export interface Verdict {
  verdict: 'passed' | 'failed'
  requiredTotal: number; requiredPassed: number
  failed: number; notPerformed: number; skipped: number; laterTotal: number
}

const isOutlineName = (name: string) => /<[^>]+>/.test(name)
const norm = (s: string) => s.replace(/@[\w-]+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

function outlineMatcher(template: string): RegExp {
  const parts = norm(template).split(/<[^>]+>/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('.+')}$`)
}

export function inventoryFrom(entries: CastEntry[]): InventoryScenario[] {
  return entries
    .filter(e => e.kind === 'scene')
    .flatMap(e => (e.scenarios ?? []).map(s => ({
      featureFile: e.file_path, name: s.name, tags: s.tags, steps: s.steps,
      required: !s.tags.includes(LATER_TAG), isOutline: isOutlineName(s.name),
    })))
}

function outcomeOf(tests: RunTest[]): Outcome {
  if (tests.length === 0 || tests.some(t => t.status === 'fixme')) return 'not_performed'
  if (tests.some(t => t.status === 'failed')) return 'failed'
  if (tests.some(t => t.status === 'skipped')) return 'skipped'
  return 'passed'
}

export function matchScenarios(inventory: InventoryScenario[], tests: RunTest[]): { outcomes: ScenarioOutcome[]; orphans: RunTest[] } {
  const claimed = new Set<RunTest>()
  const matched = new Map<InventoryScenario, RunTest[]>()
  const pass = (outline: boolean) => {
    for (const sc of inventory.filter(s => s.isOutline === outline)) {
      const re = outline ? outlineMatcher(sc.name) : null
      const mine = tests.filter(t => !claimed.has(t) && t.featureFile === sc.featureFile
        && (re ? re.test(norm(t.title)) : norm(t.title) === norm(sc.name)))
      mine.forEach(t => claimed.add(t))
      matched.set(sc, mine)
    }
  }
  pass(false)   // literal scenarios claim their tests first
  pass(true)
  const outcomes = inventory.map(sc => {
    const mine = matched.get(sc) ?? []
    return { scenario: sc, tests: mine, outcome: outcomeOf(mine) }
  })
  return { outcomes, orphans: tests.filter(t => !claimed.has(t)) }
}

export function verdictOf(outcomes: ScenarioOutcome[]): Verdict {
  const required = outcomes.filter(o => o.scenario.required)
  const count = (o: Outcome) => required.filter(r => r.outcome === o).length
  const requiredPassed = count('passed')
  return {
    verdict: required.length > 0 && requiredPassed === required.length ? 'passed' : 'failed',
    requiredTotal: required.length, requiredPassed,
    failed: count('failed'), notPerformed: count('not_performed'), skipped: count('skipped'),
    laterTotal: outcomes.length - required.length,
  }
}

export function summaryLine(v: Verdict): string {
  if (v.requiredTotal === 0) return 'no required scenes found'
  if (v.verdict === 'passed') {
    return `${v.requiredPassed}/${v.requiredTotal} required scenes passed${v.laterTotal ? ` · ${v.laterTotal} for later` : ''}`
  }
  return [
    v.failed && `${v.failed} failed`,
    v.notPerformed && `${v.notPerformed} not performed`,
    v.skipped && `${v.skipped} skipped`,
  ].filter(Boolean).join(' · ')
}
