import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { playwrightConfigFor, stageScript } from './layout.ts'

const roots: string[] = []
function project(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'spd-layout-'))
  roots.push(root)
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    writeFileSync(join(root, f), '')
  }
  return root
}
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

describe('layout', () => {
  test('new layout: .stage/config and .stage/scripts', () => {
    const root = project([
      '.stage/config/playwright.config.ts', 'playwright.config.ts',
      '.stage/scripts/post-spd-results.ts', 'scripts/post-spd-results.ts',
    ])
    expect(playwrightConfigFor(root)).toBe('.stage/config/playwright.config.ts')
    expect(stageScript(root, 'post-spd-results.ts')).toBe('.stage/scripts/post-spd-results.ts')
  })

  test('old layout: root playwright.config.ts and scripts/', () => {
    const root = project(['playwright.config.ts', 'scripts/post-spd-results.ts'])
    expect(playwrightConfigFor(root)).toBe('playwright.config.ts')
    expect(stageScript(root, 'post-spd-results.ts')).toBe('scripts/post-spd-results.ts')
  })

  test('neither: null', () => {
    const root = project([])
    expect(playwrightConfigFor(root)).toBeNull()
    expect(stageScript(root, 'post-spd-results.ts')).toBeNull()
  })
})
