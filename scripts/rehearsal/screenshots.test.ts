import { describe, expect, test } from 'bun:test'
import type { PlaywrightReport } from './report.ts'
import type { CastEntry } from './screenplay.ts'
import { renderVerdict } from './screenshots.ts'
import { inventoryFrom } from './verdict.ts'

const scene = (file: string, scenarios: Array<{ name: string; tags?: string[] }>): CastEntry => ({
  kind: 'scene', file_path: `screenplay/features/${file}`, name: file, discipline: null, summary: '',
  scenarios: scenarios.map(s => ({ name: s.name, tags: s.tags ?? [], steps: [{ keyword: 'When', text: 'x' }] })),
})
const inventory = inventoryFrom([
  scene('orders.feature', [{ name: 'Albert gives free passes' }]),
  scene('wallet.feature', [{ name: 'Ivy adds her ticket to Apple Wallet', tags: ['@cast', '@later'] }]),
])
// A report with one spec per [spec file, title, status].
const report = (...specs: Array<[string, string, 'passed' | 'failed' | 'timedOut']>): PlaywrightReport => ({
  stats: { expected: 0, unexpected: specs.filter(s => s[2] !== 'passed').length, skipped: 0 },
  suites: specs.map(([file, title, status]) => ({
    title: file, file,
    specs: [{ title, ok: status === 'passed', tests: [{ results: [{ status, duration: 1, attachments: [] }] }] }],
  })),
})

describe('renderVerdict', () => {
  test('a render that passed is fine', () => {
    expect(renderVerdict('success', null, inventory).ok).toBe(true)
  })

  test('a failing @later scene alone does not fail the render', () => {
    const v = renderVerdict('failure', report(
      ['orders.spec.ts', 'Albert gives free passes @cast', 'passed'],
      ['wallet.spec.ts', 'Ivy adds her ticket to Apple Wallet @cast @later', 'timedOut'],
    ), inventory)
    expect(v.ok).toBe(true)
    expect(v.reason).toContain('Ivy adds her ticket to Apple Wallet')
  })

  test('a failing required scene fails the render, and is named', () => {
    const v = renderVerdict('failure', report(
      ['orders.spec.ts', 'Albert gives free passes @cast', 'failed'],
      ['wallet.spec.ts', 'Ivy adds her ticket to Apple Wallet @cast @later', 'failed'],
    ), inventory)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('Albert gives free passes')
    expect(v.reason).not.toContain('Ivy')
  })

  test('a failing test that matches no scene fails the render', () => {
    const v = renderVerdict('failure', report(['extra.spec.ts', 'Something unlisted', 'failed']), inventory)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('Something unlisted')
  })

  test('a failed render with no failing test is a crash', () => {
    const v = renderVerdict('failure', report(['orders.spec.ts', 'Albert gives free passes', 'passed']), inventory)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/no failing scene/)
  })

  test('a failed render with no report fails', () => {
    expect(renderVerdict('failure', null, inventory)).toEqual({ ok: false, reason: 'Playwright failed and wrote no report' })
  })

  test('a render that was cancelled or skipped fails', () => {
    expect(renderVerdict('cancelled', null, inventory).ok).toBe(false)
    expect(renderVerdict('', null, inventory).ok).toBe(false)
  })
})
