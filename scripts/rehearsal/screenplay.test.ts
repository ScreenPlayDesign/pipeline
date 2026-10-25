import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectCastEntries, parseScenarios } from './screenplay.ts'

describe('parseScenarios', () => {
  test('Background steps lead every scenario', () => {
    const s = parseScenarios(`Feature: Map
  Background:
    Given the festival is open
  Scenario: Kira filters
    When she filters
    Then pins hide`)
    expect(s).toEqual([{ name: 'Kira filters', tags: [], steps: [
      { keyword: 'Given', text: 'the festival is open' },
      { keyword: 'When', text: 'she filters' },
      { keyword: 'Then', text: 'pins hide' },
    ] }])
  })

  test('tags above Feature: apply to every scenario (R2)', () => {
    const s = parseScenarios(`@later
Feature: Wallet
  @cast
  Scenario: Sam spends points
    When he spends
  Scenario: Ivy adds a pass
    When she adds`)
    expect(s.map(x => x.tags)).toEqual([['@later', '@cast'], ['@later']])
  })

  test('tags above Rule: apply within that rule only', () => {
    // In Gherkin every scenario after a Rule: belongs to it until the next
    // Rule:, whatever the indentation.
    const s = parseScenarios(`Feature: F
  @later
  Rule: Later things
    Scenario: A
      When a
  Rule: Now
    Scenario: B
      When b`)
    expect(s.map(x => [x.name, x.tags])).toEqual([['A', ['@later']], ['B', []]])
  })

  test('outline names keep their <placeholders>; doc strings are ignored', () => {
    const s = parseScenarios(`Feature: F
  Scenario Outline: A phone set to <lang> opens in <shown>
    Given a note
      """
      Scenario: not a scenario
      """
    Then it shows <shown>
    Examples:
      | lang | shown |
      | de   | German |`)
    expect(s).toHaveLength(1)
    expect(s[0].name).toBe('A phone set to <lang> opens in <shown>')
  })
})

describe('collectCastEntries', () => {
  const root = mkdtempSync(join(tmpdir(), 'spd-screenplay-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const sp = join(root, 'screenplay')
  mkdirSync(join(sp, 'features'), { recursive: true })
  mkdirSync(join(sp, 'personae', 'beth-iphone-se'), { recursive: true })
  mkdirSync(join(sp, 'setting'), { recursive: true })
  writeFileSync(join(sp, 'features', 'map.feature'), `Feature: The map
  Pins and filters.
  Scenario: Kira filters
    When she filters`)
  writeFileSync(join(sp, 'personae', 'beth-iphone-se', 'account_settings.md'),
    `---\nname: Beth\nrole: attendee\ndevice: iPhone SE\n---\nBeth is new to the festival.`)
  writeFileSync(join(sp, 'personae', 'beth-iphone-se', 'avatar.svg'), '<svg/>')
  writeFileSync(join(sp, 'setting', 'stakeholders.md'), '# Stakeholders\nThe real people.')

  test('reads scenes, personae and setting with project-relative paths', () => {
    const entries = collectCastEntries(sp)
    const scene = entries.find(e => e.kind === 'scene')!
    expect(scene.file_path).toBe('screenplay/features/map.feature')
    expect(scene.name).toBe('The map')
    expect(scene.scenarios?.map(s => s.name)).toEqual(['Kira filters'])
    const beth = entries.find(e => e.kind === 'persona')!
    expect(beth).toMatchObject({ actor_key: 'beth', name: 'Beth', role: 'attendee', device: 'iPhone SE' })
    expect(beth.avatar_path).toBe(join(sp, 'personae', 'beth-iphone-se', 'avatar.svg'))
    expect(entries.find(e => e.kind === 'setting')?.file_path).toBe('screenplay/setting/stakeholders.md')
  })

  test('reads personae/<handle>/ at the repo root before screenplay/personae/', () => {
    const r = mkdtempSync(join(tmpdir(), 'spd-screenplay-root-'))
    try {
      const dir = join(r, 'screenplay')
      mkdirSync(join(dir, 'features'), { recursive: true })
      mkdirSync(join(r, 'personae', 'albert'), { recursive: true })
      mkdirSync(join(dir, 'personae', 'old-desktop'), { recursive: true })
      writeFileSync(join(r, 'personae', 'albert', 'account_settings.md'), '---\npersona: albert\nname: Albert\ndevice: Laptop Chrome\n---\nThe owner.')
      writeFileSync(join(r, 'personae', 'albert', 'avatar.svg'), '<svg/>')
      writeFileSync(join(dir, 'personae', 'old-desktop', 'account_settings.md'), '---\nname: Old\n---\nIgnored once personae/ exists.')
      const personae = collectCastEntries(dir).filter(e => e.kind === 'persona')
      expect(personae.map(p => p.actor_key)).toEqual(['albert'])
      expect(personae[0].file_path).toBe('personae/albert/account_settings.md')
      expect(personae[0].avatar_path).toBe(join(r, 'personae', 'albert', 'avatar.svg'))
    } finally { rmSync(r, { recursive: true, force: true }) }
  })

  test('reads screenplay/cast/ before personae/', () => {
    const r = mkdtempSync(join(tmpdir(), 'spd-screenplay-cast-'))
    try {
      const dir = join(r, 'screenplay')
      mkdirSync(join(dir, 'features'), { recursive: true })
      mkdirSync(join(dir, 'cast', 'kira'), { recursive: true })
      mkdirSync(join(r, 'personae', 'albert'), { recursive: true })
      writeFileSync(join(dir, 'cast', 'kira', 'account_settings.md'), '---\nname: Kira\n---\nThe organiser.')
      writeFileSync(join(r, 'personae', 'albert', 'account_settings.md'), '---\nname: Albert\n---\nIgnored once screenplay/cast/ exists.')
      const personae = collectCastEntries(dir).filter(e => e.kind === 'persona')
      expect(personae.map(p => p.actor_key)).toEqual(['kira'])
      expect(personae[0].file_path).toBe('screenplay/cast/kira/account_settings.md')
    } finally { rmSync(r, { recursive: true, force: true }) }
  })

  test('skips symlinked scenes, markdown and avatars', () => {
    const r = mkdtempSync(join(tmpdir(), 'spd-screenplay-link-'))
    try {
      const secret = join(r, 'outside.txt')
      writeFileSync(secret, 'Feature: Stolen\n  Scenario: Leak\n    When it leaks')
      const dir = join(r, 'screenplay')
      mkdirSync(join(dir, 'features'), { recursive: true })
      mkdirSync(join(dir, 'personae', 'ann-pixel'), { recursive: true })
      mkdirSync(join(dir, 'setting'), { recursive: true })
      writeFileSync(join(dir, 'features', 'real.feature'), 'Feature: Real\n  Scenario: Fine\n    When ok')
      symlinkSync(secret, join(dir, 'features', 'link.feature'))
      writeFileSync(join(dir, 'personae', 'ann-pixel', 'account_settings.md'), '---\nname: Ann\n---\nAnn.')
      symlinkSync(secret, join(dir, 'personae', 'ann-pixel', 'avatar.svg'))
      symlinkSync(secret, join(dir, 'setting', 'linked.md'))
      const entries = collectCastEntries(dir)
      expect(entries.filter(e => e.kind === 'scene').map(e => e.name)).toEqual(['Real'])
      expect(entries.filter(e => e.kind === 'setting')).toEqual([])
      expect(entries.find(e => e.kind === 'persona')!.avatar_path).toBeUndefined()
    } finally { rmSync(r, { recursive: true, force: true }) }
  })
})
