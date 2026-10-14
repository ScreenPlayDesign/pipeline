import { expect, test } from 'bun:test'
import { resetCast, type SqlRunner } from './reset.ts'

const url = 'postgres://postgres:s3cret-pw@db.example.test:5432/postgres'

function runner(opts: { fail?: Error } = {}) {
  const log: string[] = []
  const r: SqlRunner = {
    unsafe: async (text: string) => { log.push(`unsafe:${text}`); if (opts.fail) throw opts.fail },
    close: async () => { log.push('close') },
  }
  return { log, open: (u: string) => { log.push(`open:${u}`); return r } }
}

test('runs the whole script through the driver and closes the connection', async () => {
  const { log, open } = runner()
  await resetCast(url, 'select 1; select 2;', { open })
  expect(log).toEqual([`open:${url}?sslmode=require`, 'unsafe:select 1; select 2;', 'close'])
})

test('closes the connection when the script fails, and the error never carries the URL', async () => {
  const { log, open } = runner({ fail: new Error(`connect failed for ${url}`) })
  const err = await resetCast(url, 'select 1', { open }).catch(e => e as Error)
  expect(err).toBeInstanceOf(Error)
  expect(err.message).not.toContain('s3cret-pw')
  expect(err.message).not.toContain('db.example.test')
  expect(log.at(-1)).toBe('close')
})

test('a failure while opening the connection is reported without the URL', async () => {
  const err = await resetCast(url, 'select 1', { open: () => { throw new Error(`bad ${url}`) } }).catch(e => e as Error)
  expect(err.message).not.toContain('s3cret-pw')
})

const tlsOk = new Set(['require', 'verify-ca', 'verify-full'])
const modeOf = (u: string) => new URL(u).searchParams.get('sslmode')

for (const [label, input, expected] of [
  ['no sslmode', url, 'require'],
  ['sslmode=disable', `${url}?sslmode=disable`, 'require'],
  ['sslmode=allow', `${url}?sslmode=allow`, 'require'],
  ['sslmode=prefer', `${url}?sslmode=prefer`, 'require'],
  ['sslmode=require', `${url}?sslmode=require`, 'require'],
  ['sslmode=verify-ca', `${url}?sslmode=verify-ca`, 'verify-ca'],
  ['sslmode=verify-full', `${url}?sslmode=verify-full&application_name=x`, 'verify-full'],
] as const) {
  test(`TLS is required when the URL has ${label}`, async () => {
    const seen: string[] = []
    await resetCast(input, 'select 1', { open: u => { seen.push(u); return runner().open(u) } })
    expect(tlsOk.has(modeOf(seen[0]!)!)).toBe(true)
    expect(modeOf(seen[0]!)).toBe(expected)
    expect(new URL(seen[0]!).password).toBe('s3cret-pw')
  })
}

test('the URL never appears in a thrown or logged message', async () => {
  const logged: string[] = []
  const spies = (['log', 'warn', 'error'] as const).map(k => {
    const orig = console[k]; console[k] = (...a: unknown[]) => { logged.push(a.join(' ')) }
    return () => { console[k] = orig }
  })
  try {
    const err = await resetCast(`${url}?sslmode=disable`, 'select 1', { open: runner({ fail: new Error(`x ${url}`) }).open }).catch(e => e as Error)
    expect(err.message).not.toContain('s3cret-pw')
    const err2 = await resetCast('not a url with s3cret-pw', 'select 1', { open: () => { throw new Error('boom s3cret-pw') } }).catch(e => e as Error)
    expect(err2.message).not.toContain('s3cret-pw')
  } finally { spies.forEach(f => f()) }
  expect(logged.join('\n')).not.toContain('s3cret-pw')
})
