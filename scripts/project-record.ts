// copied from client/shared/projectRecord.ts sha256:47f8a0c1f7cb2dcc23ee058f6ef43a0bfde664dfb921d6e99ca072e953835dab — do not edit; run make sync-spd-config in client
// What a project is: the hub's record, the identity that finds it, and the cache that stands in for
// the hub when it cannot be reached.
//
// Self-contained on purpose: the only runtime dependencies are Bun/Node's fetch and node:fs, node:os
// and node:path, because this file is copied byte-for-byte into other repos (see
// scripts/sync-spd-config.sh). Change it here, then sync the copies; never edit a copy.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** What the hub's project_record() returns. */
export interface ProjectRecord {
  slug: string
  name: string
  description: string
  kind: string
  shape: string
  domain: string | null
  github: { org: string; repo: string; install_id: number | null }
  supabase: { staging_ref: string | null; prod_ref: string | null }
  cloudflare: { account_id: string | null; pages_project: string | null; type: string | null }
  /** lane -> url; 'prod' is included */
  urls: Record<string, string>
  backend: { project: string; contract: string } | null
  frontends: string[]
  companion: { slug: string; shape: string } | null
  design_repo: string | null
  lanes_hub: boolean
  playhouse: boolean
  house: boolean
  rehearsal_gate: boolean
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * The GitHub org and repo a git remote URL names, or null for any other host (a Forgejo remote, say).
 * Reads `git@github.com:Org/Repo.git`, `https://github.com/Org/Repo`, `ssh://git@github.com/Org/Repo.git`,
 * a trailing slash or `.git`, and credentials in the URL. The host is matched without regard to case;
 * the org and repo keep the case written, so compare them without regard to case.
 */
export function repoFromRemote(url: string): { org: string; repo: string } | null {
  const text = url.trim()
  let host: string
  let path: string
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(text)
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?([^:/\s]+)(?::\d+)?\/(.+)$/i.exec(text)
  if (scheme) [, host, path] = scheme
  else if (scp) [, host, path] = scp
  else return null
  host = host.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null
  const parts = path.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '').split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { org: parts[0], repo: parts[1] }
}

// ── The hub ──────────────────────────────────────────────────────────────────

export type FetchResult = { ok: true; record: ProjectRecord } | { ok: false; status: number | 'offline' }

/**
 * Ask the hub for a record by slug (`GET <api>/record/<slug>`) or by repo (`GET <api>/record?repo=<org>/<repo>`).
 * A fetch that throws is 'offline'; any other non-200 answer is its status (403, 404).
 */
export async function fetchRecord(opts: {
  api: string
  token: string
  slug?: string
  repo?: { org: string; repo: string }
  fetch?: typeof fetch
}): Promise<FetchResult> {
  const base = opts.api.replace(/\/+$/, '')
  const url = opts.slug
    ? `${base}/record/${encodeURIComponent(opts.slug)}`
    : opts.repo
      ? `${base}/record?repo=${encodeURIComponent(`${opts.repo.org}/${opts.repo.repo}`)}`
      : null
  if (!url) return { ok: false, status: 400 }
  let res: Response
  try {
    res = await (opts.fetch ?? fetch)(url, { headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/json' } })
  } catch {
    return { ok: false, status: 'offline' }
  }
  if (res.status !== 200) return { ok: false, status: res.status }
  try {
    const body = (await res.json()) as { record?: ProjectRecord }
    if (body && typeof body.record === 'object' && body.record !== null && typeof body.record.slug === 'string') {
      return { ok: true, record: body.record }
    }
  } catch {
    // fall through: a 200 without a record is a bad answer
  }
  return { ok: false, status: 502 }
}

// ── The cache: ~/.config/spd/cache/<slug>.json = { fetched_at, record } ─────

export const defaultCacheDir = (): string => join(process.env.HOME || homedir(), '.config', 'spd', 'cache')

const cacheFile = (dir: string, slug: string) => join(dir, `${slug.replace(/[^A-Za-z0-9._-]/g, '_')}.json`)

function readCacheFile(file: string): { fetched_at: string; record: ProjectRecord } | null {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    if (j && typeof j.fetched_at === 'string' && j.record && typeof j.record.slug === 'string') return j
  } catch {
    // a missing or damaged cache file is no cache
  }
  return null
}

export function readCachedRecord(slug: string, dir: string = defaultCacheDir(), now: () => number = Date.now): { record: ProjectRecord; ageMs: number } | null {
  const j = readCacheFile(cacheFile(dir, slug))
  if (!j) return null
  const at = Date.parse(j.fetched_at)
  return { record: j.record, ageMs: Number.isFinite(at) ? Math.max(0, now() - at) : 0 }
}

export function writeCachedRecord(record: ProjectRecord, dir: string = defaultCacheDir(), now: () => number = Date.now): void {
  mkdirSync(dir, { recursive: true })
  const file = cacheFile(dir, record.slug)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ fetched_at: new Date(now()).toISOString(), record }, null, 2) + '\n')
  renameSync(tmp, file)
}

/** The slug of a cached record for this GitHub org and repo (compared without regard to case), or null. */
export function cachedSlugForRepo(org: string, repo: string, dir: string = defaultCacheDir()): string | null {
  if (!existsSync(dir)) return null
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const j = readCacheFile(join(dir, name))
    if (j && j.record.github?.org?.toLowerCase() === org.toLowerCase() && j.record.github?.repo?.toLowerCase() === repo.toLowerCase()) {
      return j.record.slug
    }
  }
  return null
}

/** The age of a cached record in words, for the line that says a cached record was used. */
export function describeAge(ageMs: number): string {
  const s = Math.round(ageMs / 1000)
  if (s < 90) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 90) return `${m} minutes`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`
}

// ── Resolve ──────────────────────────────────────────────────────────────────

export class RecordUnavailable extends Error {
  readonly status: number | 'offline'
  constructor(message: string, status: number | 'offline') {
    super(message)
    this.name = 'RecordUnavailable'
    this.status = status
  }
}

/**
 * The record for a project: the hub first (a success rewrites the cache, so the cache never outranks a
 * reachable hub); the cache only when the hub cannot be reached. `ageMs` is 0 from the hub and the cache
 * file's age from the cache, so a caller can say how old the record it used is.
 */
export async function resolveRecord(opts: {
  api: string
  token: string
  slug?: string
  repo?: { org: string; repo: string }
  fetch?: typeof fetch
  cacheDir?: string
  now?: () => number
}): Promise<{ record: ProjectRecord; source: 'hub' | 'cache'; ageMs: number }> {
  const dir = opts.cacheDir ?? defaultCacheDir()
  const now = opts.now ?? Date.now
  const what = opts.slug ?? (opts.repo ? `${opts.repo.org}/${opts.repo.repo}` : 'this project')
  const got = await fetchRecord(opts)
  if (got.ok) {
    try {
      writeCachedRecord(got.record, dir, now)
    } catch {
      // a cache that cannot be written must not fail a read that worked
    }
    return { record: got.record, source: 'hub', ageMs: 0 }
  }
  if (got.status !== 'offline') {
    throw new RecordUnavailable(`the hub answered ${got.status} for ${what}${got.status === 403 ? ' (this token may not read that project)' : got.status === 404 ? ' (no such project)' : ''}`, got.status)
  }
  const slug = opts.slug ?? (opts.repo ? cachedSlugForRepo(opts.repo.org, opts.repo.repo, dir) : null)
  const cached = slug ? readCachedRecord(slug, dir, now) : null
  if (cached) return { record: cached.record, source: 'cache', ageMs: cached.ageMs }
  throw new RecordUnavailable(`the hub cannot be reached and there is no cached record for ${what}`, 'offline')
}
