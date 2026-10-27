import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Each copy is the client's file with a first line naming its sha256. The hash covers the bytes
// after that line, down to the CLI marker line when the copy has one. A copy is never edited by hand.
const MARKER = '// ── CLI (not part of the hashed copy) ──\n'
const HEADER = /^\/\/ copied from (client\/shared\/\S+) sha256:([0-9a-f]{64}) — do not edit; run make sync-spd-config in client\n/

function hashOf(text: string): { named: string; actual: string } {
  const header = HEADER.exec(text)
  if (!header) throw new Error('the first line is not a "copied from client/shared/..." header')
  const body = text.slice(header[0].length)
  const at = body.indexOf(MARKER)
  const hashed = at === -1 ? body : body.slice(0, at)
  return { named: header[2] as string, actual: createHash('sha256').update(hashed).digest('hex') }
}

function verify(file: string, text: string): void {
  const { named, actual } = hashOf(text)
  if (named !== actual) throw new Error(`${file} was edited by hand: its header names sha256:${named} but its bytes hash to sha256:${actual}; run make sync-spd-config in client`)
}

const FILES = ['spd-config.ts']

for (const file of FILES) {
  test(`${file} matches the hash it names`, () => {
    expect(() => verify(file, readFileSync(join(import.meta.dir, file), 'utf8'))).not.toThrow()
  })

  test(`a hand edit of ${file} fails, naming the file and both hashes`, () => {
    const text = readFileSync(join(import.meta.dir, file), 'utf8')
    const header = HEADER.exec(text) as RegExpExecArray
    const edited = text.replace(header[0], header[0] + '// hand edit\n')
    const { named, actual } = hashOf(edited)
    expect(() => verify(file, edited)).toThrow(`${file} was edited by hand`)
    expect(() => verify(file, edited)).toThrow(`sha256:${named}`)
    expect(() => verify(file, edited)).toThrow(`sha256:${actual}`)
    expect(actual).not.toBe(named)
  })
}
