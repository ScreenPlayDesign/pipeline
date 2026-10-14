import { expect, test } from 'bun:test'
import { notPerformedRow, runPayload } from './post.ts'
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
  })
})

test('no report means verdict error and a failed run', () => {
  const p = runPayload({ slug: 's', sha: 'b'.repeat(40), verdict: null, description: 'Playwright produced no report',
    scenarios: [], runUrl: null, runKey: 'k', baseUrl: 'u' })
  expect(p).toMatchObject({ status: 'failed', verdict: 'error', required_total: null })
})
