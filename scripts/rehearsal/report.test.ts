import { describe, expect, test } from 'bun:test'
import { featureFileFor, runTestsFrom, slugify, splitKeyword, stripAnsi, testStatus, type PlaywrightSpec } from './report.ts'

const spec = (title: string, results: Array<{ status: string }>, annotations: Array<{ type: string }> = []): PlaywrightSpec => ({
  title, ok: true, tags: [],
  tests: [{ annotations, results: results.map(r => ({ ...r, duration: 1, attachments: [] })) as never }],
})

describe('report helpers', () => {
  test('a spec file maps to its feature file', () => {
    expect(featureFileFor('screenplay/tests/map.spec.ts')).toBe('screenplay/features/map.feature')
    expect(featureFileFor('map.spec.ts')).toBe('screenplay/features/map.feature')
  })
  test('fixme is detected from the test annotations', () => {
    expect(testStatus(spec('x', [{ status: 'skipped' }], [{ type: 'fixme' }]))).toBe('fixme')
  })
  test('the last attempt decides; timeouts and interrupts are failures', () => {
    expect(testStatus(spec('x', [{ status: 'passed' }]))).toBe('passed')
    expect(testStatus(spec('x', [{ status: 'skipped' }]))).toBe('skipped')
    expect(testStatus(spec('x', [{ status: 'timedOut' }]))).toBe('failed')
    expect(testStatus(spec('x', [{ status: 'interrupted' }]))).toBe('failed')
  })
  test('nested suites flatten with their file', () => {
    const tests = runTestsFrom({ stats: { expected: 1, unexpected: 0, skipped: 0 }, suites: [
      { title: 'map.spec.ts', file: 'map.spec.ts', suites: [{ title: 'inner', specs: [spec('Kira filters @cast', [{ status: 'passed' }])] }] },
    ] })
    expect(tests.map(x => [x.featureFile, x.title, x.status])).toEqual([['screenplay/features/map.feature', 'Kira filters', 'passed']])
  })
  test('text helpers', () => {
    expect(slugify('Kira filters the map @cast')).toBe('kira-filters-the-map')
    expect(splitKeyword('When Beth checks in')).toEqual({ keyword: 'When', text: 'Beth checks in' })
    expect(stripAnsi('\u001b[31mred\u001b[39m')).toBe('red')
  })
})
