import { expect, test } from 'bun:test'
import { pgEnvFromUrl, shellExports } from './pgenv.ts'

test('a full URL with port, an encoded password and sslmode', () => {
  expect(pgEnvFromUrl('postgresql://postgres.abc:p%40ss@db.example.com:6543/app?sslmode=require')).toEqual({
    PGHOST: 'db.example.com', PGPORT: '6543', PGUSER: 'postgres.abc', PGPASSWORD: 'p@ss',
    PGDATABASE: 'app', PGSSLMODE: 'require',
  })
})

test('postgres:// is accepted, and the port and database default', () => {
  expect(pgEnvFromUrl('postgres://u:pw@localhost')).toEqual({
    PGHOST: 'localhost', PGPORT: '5432', PGUSER: 'u', PGPASSWORD: 'pw', PGDATABASE: 'postgres',
  })
})

test('no sslmode query means no PGSSLMODE', () => {
  expect(pgEnvFromUrl('postgres://u:pw@h:5432/db')).not.toHaveProperty('PGSSLMODE')
})

test('a non-postgres URL throws, and the message keeps the password out', () => {
  const url = 'mysql://u:SECRET-pw@h/db'
  let message = ''
  try { pgEnvFromUrl(url) } catch (e) { message = (e as Error).message }
  expect(message).not.toBe('')
  expect(message).not.toContain('SECRET-pw')
  expect(message).not.toContain('mysql://')
})

test('an unparseable URL throws without echoing it', () => {
  let message = ''
  try { pgEnvFromUrl('not a url SECRET-pw') } catch (e) { message = (e as Error).message }
  expect(message).not.toBe('')
  expect(message).not.toContain('SECRET-pw')
})

test('shellExports quotes values so sh reads them back exactly', () => {
  const out = shellExports({ PGPASSWORD: "it's a 'pw' $HOME" })
  expect(out).toBe(`export PGPASSWORD='it'\\''s a '\\''pw'\\'' $HOME'\n`)
  const back = Bun.spawnSync(['sh', '-c', `${out}printf %s "$PGPASSWORD"`]).stdout.toString()
  expect(back).toBe("it's a 'pw' $HOME")
})
