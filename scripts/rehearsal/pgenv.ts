// scripts/rehearsal/pgenv.ts — turn a postgres URL into libpq environment
// variables, so psql never receives the password in its argv.

export function pgEnvFromUrl(url: string): Record<string, string> {
  let u: URL
  try { u = new URL(url) } catch {
    throw new Error('the database URL is not a valid URL')
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error('the database URL must use the postgres:// or postgresql:// scheme')
  }
  const host = u.hostname.replace(/^\[(.*)\]$/, '$1')
  if (!host) throw new Error('the database URL has no host')
  const env: Record<string, string> = {
    PGHOST: host,
    PGPORT: u.port || '5432',
    PGUSER: decode(u.username),
    PGPASSWORD: decode(u.password),
    PGDATABASE: decode(u.pathname.replace(/^\//, '')) || 'postgres',
  }
  const sslmode = u.searchParams.get('sslmode')
  if (sslmode) env.PGSSLMODE = sslmode
  return env
}

function decode(part: string): string {
  try { return decodeURIComponent(part) } catch {
    throw new Error('the database URL contains malformed percent-encoding')
  }
}

// `export NAME='value'` lines for `eval`, with every single quote in a value
// written as '\'' so the shell reads it back exactly.
export function shellExports(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([name, value]) => `export ${name}='${value.replace(/'/g, `'\\''`)}'`)
    .join('\n') + '\n'
}
