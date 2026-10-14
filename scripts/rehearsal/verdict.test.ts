import { describe, expect, test } from 'bun:test'
import type { CastEntry } from './screenplay.ts'
import { inventoryFrom, matchScenarios, summaryLine, verdictOf, type RunTest } from './verdict.ts'

const scene = (file: string, scenarios: Array<{ name: string; tags?: string[] }>): CastEntry => ({
  kind: 'scene', file_path: `screenplay/features/${file}`, name: file, discipline: null, summary: '',
  scenarios: scenarios.map(s => ({ name: s.name, tags: s.tags ?? [], steps: [{ keyword: 'When', text: 'x' }] })),
})
const t = (file: string, title: string, status: RunTest['status'] = 'passed'): RunTest =>
  ({ featureFile: `screenplay/features/${file}`, title, status })

describe('inventoryFrom', () => {
  test('a scenario is required unless tagged @later', () => {
    const inv = inventoryFrom([scene('a.feature', [{ name: 'One' }, { name: 'Two', tags: ['@cast', '@later'] }])])
    expect(inv.map(s => [s.name, s.required])).toEqual([['One', true], ['Two', false]])
  })
  test('outlines are recognised by their <placeholders>', () => {
    expect(inventoryFrom([scene('a.feature', [{ name: 'Set to <lang>' }])])[0].isOutline).toBe(true)
  })
})

describe('matchScenarios', () => {
  test('matches by title within the same feature file, ignoring inline tags and case', () => {
    const inv = inventoryFrom([
      scene('tickets.feature', [{ name: 'Sam buys passes' }]),
      scene('wallet.feature', [{ name: 'Sam buys passes' }]),
    ])
    const { outcomes, orphans } = matchScenarios(inv, [
      t('tickets.feature', 'sam buys passes @cast'),
      t('wallet.feature', 'Sam buys passes', 'failed'),
    ])
    expect(outcomes.map(o => [o.scenario.featureFile, o.outcome])).toEqual([
      ['screenplay/features/tickets.feature', 'passed'],
      ['screenplay/features/wallet.feature', 'failed'],
    ])
    expect(orphans).toEqual([])
  })

  test('an outline passes only if every example test passes', () => {
    const inv = inventoryFrom([scene('arrival.feature', [{ name: 'A phone set to <lang> opens the app in <shown>' }])])
    const all = matchScenarios(inv, [
      t('arrival.feature', 'A phone set to German (Austria) opens the app in German'),
      t('arrival.feature', 'A phone set to French opens the app in English'),
    ])
    expect(all.outcomes[0]).toMatchObject({ outcome: 'passed' })
    expect(all.outcomes[0].tests).toHaveLength(2)
    const one = matchScenarios(inv, [
      t('arrival.feature', 'A phone set to German (Austria) opens the app in German'),
      t('arrival.feature', 'A phone set to French opens the app in English', 'failed'),
    ])
    expect(one.outcomes[0].outcome).toBe('failed')
  })

  test('a literal scenario claims its test before an outline can', () => {
    const inv = inventoryFrom([scene('a.feature', [{ name: 'Opens in <lang>' }, { name: 'Opens in German' }])])
    const { outcomes } = matchScenarios(inv, [t('a.feature', 'Opens in German'), t('a.feature', 'Opens in French')])
    expect(outcomes.map(o => o.tests.map(x => x.title))).toEqual([['Opens in French'], ['Opens in German']])
  })

  test('no test, or a fixme, is not performed; a skip is skipped', () => {
    const inv = inventoryFrom([scene('a.feature', [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }])])
    const { outcomes } = matchScenarios(inv, [t('a.feature', 'Two', 'fixme'), t('a.feature', 'Three', 'skipped')])
    expect(outcomes.map(o => o.outcome)).toEqual(['not_performed', 'not_performed', 'skipped'])
  })

  test('a test with no scenario is an orphan', () => {
    const { orphans } = matchScenarios(inventoryFrom([scene('a.feature', [{ name: 'One' }])]),
      [t('a.feature', 'One'), t('a.feature', 'Renamed scene')])
    expect(orphans.map(o => o.title)).toEqual(['Renamed scene'])
  })
})

describe('verdictOf', () => {
  const run = (scenarios: Array<{ name: string; tags?: string[] }>, tests: RunTest[]) =>
    verdictOf(matchScenarios(inventoryFrom([scene('a.feature', scenarios)]), tests).outcomes)

  test('green only when every required scenario passed', () => {
    const v = run([{ name: 'One' }, { name: 'Later', tags: ['@later'] }], [t('a.feature', 'One')])
    expect(v).toEqual({ verdict: 'passed', requiredTotal: 1, requiredPassed: 1, failed: 0, notPerformed: 0, skipped: 0, laterTotal: 1 })
    expect(summaryLine(v)).toBe('1/1 required scenes passed · 1 for later')
  })
  test('a failing or missing @later scenario never blocks', () => {
    expect(run([{ name: 'One' }, { name: 'L', tags: ['@later'] }], [t('a.feature', 'One'), t('a.feature', 'L', 'failed')]).verdict).toBe('passed')
  })
  test('failed, not performed and skipped required scenarios block', () => {
    const v = run([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
      [t('a.feature', 'A'), t('a.feature', 'B', 'failed'), t('a.feature', 'D', 'skipped')])
    expect(v).toMatchObject({ verdict: 'failed', requiredTotal: 4, requiredPassed: 1, failed: 1, notPerformed: 1, skipped: 1 })
    expect(summaryLine(v)).toBe('1 failed · 1 not performed · 1 skipped')
  })
  test('no required scenarios at all is not green', () => {
    const v = run([{ name: 'L', tags: ['@later'] }], [])
    expect(v.verdict).toBe('failed')
    expect(summaryLine(v)).toBe('no required scenes found')
  })
})
