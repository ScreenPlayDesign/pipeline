import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { insideAny } from './paths.ts'

const base = mkdtempSync(join(tmpdir(), 'spd-paths-'))
afterAll(() => rmSync(base, { recursive: true, force: true }))
const review = join(base, 'project', 'review')
mkdirSync(join(review, 'walkthroughs', 'a'), { recursive: true })
writeFileSync(join(review, 'walkthroughs', 'a', 'f.png'), 'x')
writeFileSync(join(base, 'secret.txt'), 'token')
symlinkSync(join(base, 'secret.txt'), join(review, 'walkthroughs', 'a', 'link.png'))
mkdirSync(join(base, 'outside'))
symlinkSync(join(base, 'outside'), join(review, 'dirlink'))
writeFileSync(join(base, 'outside', 'g.png'), 'x')

test('a file inside an allowed root is allowed', () => {
  expect(insideAny([review], join(review, 'walkthroughs', 'a', 'f.png'))).toBe(true)
})
test('a ../ path out of the root is refused', () => {
  expect(insideAny([review], join(review, 'walkthroughs', 'a', '..', '..', '..', '..', 'secret.txt'))).toBe(false)
})
test('an absolute path elsewhere is refused', () => {
  expect(insideAny([review], join(base, 'secret.txt'))).toBe(false)
  expect(insideAny([review], '/etc/hosts')).toBe(false)
})
test('a symlinked file or a file under a symlinked directory is refused', () => {
  expect(insideAny([review], join(review, 'walkthroughs', 'a', 'link.png'))).toBe(false)
  expect(insideAny([review], join(review, 'dirlink', 'g.png'))).toBe(false)
})
test('a missing file is refused', () => {
  expect(insideAny([review], join(review, 'nope.png'))).toBe(false)
})
