import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isBlankPng } from './png.ts'
import { png } from './pngFixture.ts'

const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })

function file(bytes: Buffer | string): string {
  const d = mkdtempSync(join(tmpdir(), 'png-')); dirs.push(d)
  const p = join(d, 'shot.png'); writeFileSync(p, bytes); return p
}
const white = [255, 255, 255], ink = [20, 20, 20]

test('a one-colour screenshot is blank', () => {
  expect(isBlankPng(file(png([[white, white, white], [white, white, white]])))).toBe(true)
})
test('a screenshot with anything on it is not blank', () => {
  expect(isBlankPng(file(png([[white, white, white], [white, ink, white]])))).toBe(false)
})
test('filtered rows are decoded before judging', () => {
  expect(isBlankPng(file(png([[white, white], [white, white]], 1)))).toBe(true)
  expect(isBlankPng(file(png([[white, ink], [white, white]], 1)))).toBe(false)
})
test('anything that is not a readable PNG is never called blank', () => {
  expect(isBlankPng(file('not a png'))).toBe(false)
  expect(isBlankPng('/nonexistent/shot.png')).toBe(false)
})
