// The reusable dress rehearsal's workflow file (.github/workflows/dress-rehearsal.yml): what it promises its callers.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const text = readFileSync(join(import.meta.dir, '../../.github/workflows/dress-rehearsal.yml'), 'utf8')
const wf = Bun.YAML.parse(text) as { on: { workflow_call: { inputs: Record<string, { type: string; default?: unknown }> } } }

describe('dress-rehearsal.yml', () => {
  // 2026-10-29: four workers at once against a hosted staging project left pages on "Loading…" past the
  // 5-second limit, a different pair of scenes each run. Two by default; a caller may ask for more.
  test('scenes run on a few workers, two unless the caller says otherwise', () => {
    expect(wf.on.workflow_call.inputs.workers).toEqual({ description: expect.any(String), type: 'number', default: 2 })
    expect(text).toContain('--workers="${{ inputs.workers }}"')
    expect(text).not.toContain('--workers="$(nproc)"')
  })
})

describe('approve-screenshots.yml', () => {
  const approve = readFileSync(join(import.meta.dir, '../../.github/workflows/approve-screenshots.yml'), 'utf8')
  const steps = (Bun.YAML.parse(approve) as { jobs: { render: { steps: Array<{ id?: string; env?: Record<string, string>; run?: string }> } } }).jobs.render.steps
  const step = (id: string) => steps.find(s => s.id === id)!

  // 2026-11-07: fastnacht's @later Apple Wallet scene failed every render, so a run with every baseline
  // already matching ended red. The render's JSON report lets the collect step excuse @later scenes.
  test('the render writes a JSON report outside the project checkout', () => {
    expect(step('render').run).toContain('--reporter=line,json')
    expect(step('render').env?.PLAYWRIGHT_JSON_OUTPUT_FILE).toBe('${{ runner.temp }}/render.json')
  })
  test('a failed render with no baselines is judged by render-verdict, from the pipeline folder', () => {
    const run = step('collect').run!
    expect(run).toContain('cd "$RUNNER_TEMP/spd-pipeline"')
    expect(run).toContain('RESULTS_FILE="$RUNNER_TEMP/render.json"')
    expect(run).toContain('bun --no-env-file scripts/rehearsal/cli.ts render-verdict')
  })
})
