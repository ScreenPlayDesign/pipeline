// scripts/rehearsal/reset.ts — run a project's reset.sql against staging with
// Bun's built-in Postgres driver. psql is not used: it would execute the
// project's `\!` meta-commands as shell commands where the database URL lives.
import { SQL } from 'bun'

export interface SqlRunner {
  unsafe(text: string): Promise<unknown>
  close(): Promise<void>
}

// Bun's driver connects without TLS when the URL has no sslmode (libpq would
// try TLS first). The staging database must never be reached in clear text, so
// anything weaker than `require` is raised to it; stronger modes are kept.
function requireTls(url: string): string {
  let u: URL
  try { u = new URL(url) } catch { throw new Error('the staging database URL is not a valid URL') }
  const mode = u.searchParams.get('sslmode')
  if (mode !== 'require' && mode !== 'verify-ca' && mode !== 'verify-full') u.searchParams.set('sslmode', 'require')
  return u.toString()
}

// Errors are rewritten, so neither the URL nor its password can reach a log.
export async function resetCast(
  url: string,
  sqlText: string,
  deps: { open?: (url: string) => SqlRunner } = {},
): Promise<void> {
  const open = deps.open ?? ((u: string) => new SQL(u) as unknown as SqlRunner)
  let sql: SqlRunner
  try { sql = open(requireTls(url)) } catch {
    throw new Error('could not open a connection to the staging database')
  }
  try {
    await sql.unsafe(sqlText)
  } catch (e) {
    const code = (e as { code?: unknown })?.code
    throw new Error(`reset.sql failed against the staging database${typeof code === 'string' ? ` (${code})` : ''}`)
  } finally {
    await sql.close().catch(() => {})
  }
}
