import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectRoot, readProjectConfig } from './config.ts'

const dir = mkdtempSync(join(tmpdir(), 'spd-cfg-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('reads the slug and staging URL from spd_config.toml', () => {
  writeFileSync(join(dir, 'spd_config.toml'), `[app]
name = "fastnacht-lancaster"

[env.staging]
url = "https://staging.fastnacht-lancaster.pages.dev"   # branch alias
`)
  expect(readProjectConfig(dir)).toEqual({
    slug: 'fastnacht-lancaster', stagingUrl: 'https://staging.fastnacht-lancaster.pages.dev',
  })
})

test('names the missing key', () => {
  writeFileSync(join(dir, 'spd_config.toml'), `[app]\nname = "x"\n`)
  expect(() => readProjectConfig(dir)).toThrow('[env.staging] url')
})

test('PROJECT_ROOT overrides the working directory', () => {
  expect(projectRoot({ PROJECT_ROOT: '/w/project' } as never)).toBe('/w/project')
  expect(projectRoot({} as never)).toBe(process.cwd())
})

const V2 = `schema = 2

[app]
name        = "fastnacht-lancaster"
description = "A festival site"
kind        = "local"
shape       = "app"
`

test('reads a version 2 file through spd-config.ts', () => {
  writeFileSync(join(dir, 'spd_config.toml'), `${V2}
[env.staging]
url = "https://staging.example.org/"
`)
  expect(readProjectConfig(dir)).toEqual({ slug: 'fastnacht-lancaster', stagingUrl: 'https://staging.example.org' })
})

test('refuses a file the schema refuses, with the schema reader\'s message', () => {
  writeFileSync(join(dir, 'spd_config.toml'), `${V2}
[paths]
frontend = "frontend"

[env.staging]
url = "https://staging.example.org"
`)
  expect(() => readProjectConfig(dir)).toThrow(/paths/)
})
