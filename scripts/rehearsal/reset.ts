// scripts/rehearsal/reset.ts — run a project's reset.sql against staging with
// Bun's built-in Postgres driver. psql is not used: it would execute the
// project's `\!` meta-commands as shell commands where the database URL lives.
import { SQL } from 'bun'

export interface SqlRunner {
  unsafe(text: string): Promise<unknown>
  close(): Promise<void>
}

// Errors are rewritten, so neither the URL nor its password can reach a log.
export async function resetCast(
  url: string,
  sqlText: string,
  deps: { open?: (url: string) => SqlRunner } = {},
): Promise<void> {
  const open = deps.open ?? ((u: string) => new SQL(u) as unknown as SqlRunner)
  let sql: SqlRunner
  try { sql = open(url) } catch {
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
