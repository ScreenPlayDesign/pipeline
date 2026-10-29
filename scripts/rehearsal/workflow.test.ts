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
