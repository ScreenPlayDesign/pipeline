import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_API, projectRoot, readProjectConfig } from './config.ts'

const env = { GITHUB_REPOSITORY: 'ScreenPlayDesign/fastnacht-lancaster', SPD_REHEARSAL_TOKEN: 'tok' } as NodeJS.ProcessEnv
const record = { slug: 'fastnacht-lancaster', urls: { prod: 'https://p.example', staging: 'https://staging.fastnacht-lancaster.pages.dev/' } }
const answer = (status: number, body: unknown = { record }) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

test('reads the slug and staging URL from the hub record', async () => {
  let seen = ''
  let auth = ''
  const f = (async (url: string, init: RequestInit) => {
    seen = url
    auth = (init.headers as Record<string, string>).Authorization
    return new Response(JSON.stringify({ record }), { status: 200 })
  }) as unknown as typeof fetch
  expect(await readProjectConfig(env, f)).toEqual({
    slug: 'fastnacht-lancaster', stagingUrl: 'https://staging.fastnacht-lancaster.pages.dev',
  })
  expect(seen).toBe('https://hrbfsfvyatrdxegogdfz.supabase.co/functions/v1/cli-api/record?repo=ScreenPlayDesign%2Ffastnacht-lancaster')
  expect(auth).toBe('Bearer tok')
})

test('SPD_API_URL overrides the hub base', async () => {
  let seen = ''
  const f = (async (url: string) => { seen = url; return new Response(JSON.stringify({ record }), { status: 200 }) }) as unknown as typeof fetch
  await readProjectConfig({ ...env, SPD_API_URL: 'http://localhost:9/api/cli' }, f)
  expect(seen.startsWith('http://localhost:9/api/cli/record?repo=')).toBe(true)
})

test('a 403 says the token cannot read the record', async () => {
  await expect(readProjectConfig(env, answer(403, {}))).rejects.toThrow("this repo's rehearsal token cannot read its record")
})

test('a 404, a 5xx and an unreachable hub each fail with a clear message', async () => {
  await expect(readProjectConfig(env, answer(404, {}))).rejects.toThrow('no project record')
  await expect(readProjectConfig(env, answer(503, {}))).rejects.toThrow('answered 503')
  const down = (async () => { throw new Error('boom') }) as unknown as typeof fetch
  await expect(readProjectConfig(env, down)).rejects.toThrow('could not be reached')
})

test('a record without a staging URL fails', async () => {
  await expect(readProjectConfig(env, answer(200, { record: { slug: 's', urls: { prod: 'x' } } }))).rejects.toThrow('no staging URL')
})

test('a missing repo or token fails before asking', async () => {
  await expect(readProjectConfig({ SPD_REHEARSAL_TOKEN: 't' } as never, answer(200))).rejects.toThrow('GITHUB_REPOSITORY')
  await expect(readProjectConfig({ GITHUB_REPOSITORY: 'a/b' } as never, answer(200))).rejects.toThrow('SPD_REHEARSAL_TOKEN')
})

test('PROJECT_ROOT overrides the working directory', () => {
  expect(projectRoot({ PROJECT_ROOT: '/w/project' } as never)).toBe('/w/project')
  expect(projectRoot({} as never)).toBe(process.cwd())
})

test('the record URL is built the same from either base form, with or without a trailing slash', async () => {
  for (const base of [
    'https://hrbfsfvyatrdxegogdfz.supabase.co/functions/v1/cli-api',
    'https://hrbfsfvyatrdxegogdfz.supabase.co/functions/v1/cli-api/',
    'https://screenplaydesign.com/api/cli',
    'https://screenplaydesign.com/api/cli/',
  ]) {
    let seen = ''
    const f = (async (url: string) => { seen = url; return new Response(JSON.stringify({ record }), { status: 200 }) }) as unknown as typeof fetch
    await readProjectConfig({ ...env, SPD_API_URL: base }, f)
    expect(seen).toBe(`${base.replace(/\/$/, '')}/record?repo=ScreenPlayDesign%2Ffastnacht-lancaster`)
  }
})

test('an empty SPD_API_URL (a caller that sets no api-url) falls back to the default hub', async () => {
  let seen = ''
  const f = (async (url: string) => { seen = url; return new Response(JSON.stringify({ record }), { status: 200 }) }) as unknown as typeof fetch
  await readProjectConfig({ ...env, SPD_API_URL: '' }, f)
  expect(seen.startsWith('https://hrbfsfvyatrdxegogdfz.supabase.co/functions/v1/cli-api/record?')).toBe(true)
})

test('the default hub is the workflows\' default api-url', () => {
  for (const wf of ['dress-rehearsal.yml', 'approve-screenshots.yml']) {
    const text = readFileSync(join(import.meta.dir, '..', '..', '.github', 'workflows', wf), 'utf8')
    expect(text).toContain(`default: '${DEFAULT_API}'`)
  }
})
