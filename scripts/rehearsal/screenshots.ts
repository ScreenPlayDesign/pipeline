// scripts/rehearsal/screenshots.ts — did Approve screenshots' render fail for a
// reason that matters? Playwright exits non-zero for a failing @later scene
// too; like the rehearsal's verdict (post.ts), a render whose only failures
// are @later scenes is not a failed render. A failing test that matches no
// scene counts as a failure, and so does a failed exit with nothing failing
// in the report (the run crashed).
import { runTestsFrom, type PlaywrightReport } from './report.ts'
import { matchScenarios, type InventoryScenario } from './verdict.ts'

export interface RenderVerdict { ok: boolean; reason: string }

/** outcome is the render step's outcome (success, failure, cancelled, skipped or empty). */
export function renderVerdict(outcome: string, report: PlaywrightReport | null, inventory: InventoryScenario[]): RenderVerdict {
  if (outcome === 'success') return { ok: true, reason: 'Every scene passed' }
  if (outcome !== 'failure') return { ok: false, reason: 'Playwright did not run' }
  if (!report?.suites) return { ok: false, reason: 'Playwright failed and wrote no report' }

  const tests = runTestsFrom(report)
  if (!tests.some(t => t.status === 'failed')) {
    return { ok: false, reason: 'Playwright exited with an error but recorded no failing scene' }
  }
  const { outcomes, orphans } = matchScenarios(inventory, tests)
  const failed = (later: boolean) => outcomes
    .filter(o => o.outcome === 'failed' && o.scenario.required !== later)
    .map(o => o.scenario.name)
  const blocking = [...failed(false), ...orphans.filter(t => t.status === 'failed').map(t => t.title)]
  if (blocking.length) return { ok: false, reason: `Failed: ${blocking.join('; ')}` }
  return { ok: true, reason: `Only scenes for later failed: ${failed(true).join('; ')}` }
}
