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
