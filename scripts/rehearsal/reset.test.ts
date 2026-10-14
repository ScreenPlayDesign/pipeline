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
  expect(log).toEqual([`open:${url}`, 'unsafe:select 1; select 2;', 'close'])
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
