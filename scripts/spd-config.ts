// copied from client/shared/spdConfig.ts sha256:8a3538924b1603af33060cf3e589e3924912a66533c1d81e79d79d139a29bc55 — do not edit; run make sync-spd-config in client
// The one schema for every project's spd_config.toml (version 2).
//
// Self-contained on purpose: the only runtime dependencies are Bun.TOML and
// node:fs/node:path (migrateV1 reads two things in the project folder), because
// this file is copied byte-for-byte into other repos (some run it under plain
// Bun scripts). Change it here, then sync the copies; never edit a copy.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const SCHEMA_VERSION = 2
export type Kind = 'local' | 'live'
export type Shape = 'app' | 'site'

export interface SpdConfigV2 {
  schema: 2
  app: { name: string; description: string; kind: Kind; shape: Shape }
  github?: { org: string; repo: string }
  supabase?: { staging_ref: string; prod_ref: string }
  cloudflare?: { account_id: string; project: string; type: 'pages' | 'worker'; domain?: string }
  env?: { staging?: { url: string }; prod?: { url: string } }
  companion?: { repo: string; design?: string }
  lanes?: { dev_only?: string[] }
  gateway?: { behaviour_paths?: string[] }
  rehearsal?: { required?: boolean }
  layer?: { kind: 'foundation' | 'angle' | 'implementation' | 'project'; angle?: string; upstream?: string }
}

export interface Problem {
  path: string
  message: string
  fix: string
  severity: 'error' | 'warn'
}

// ── Fixed values ─────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const SUPABASE_REF_RE = /^[a-z]{20}$/
const CLOUDFLARE_ACCOUNT_RE = /^[0-9a-f]{32}$/

/** The branches each shape has. The platform's, never written in the file. */
export const LANES_BY_SHAPE: { readonly app: readonly string[]; readonly site: readonly string[] } = {
  app: [
    'dev', 'design', 'chore', 'staging', 'prod', 'release',
    'proposal-1', 'proposal-2', 'proposal-3', 'proposal-4',
    'proposal-5', 'proposal-6', 'proposal-7', 'proposal-8',
  ],
  site: ['chore', 'design', 'staging', 'prod'],
}

// Secret NAMES (never values) a live project needs, by where they live.
// Sources, read 2026-10-27:
//   foundation-template/.github/workflows/*.yml (run-ci, run-approve-screenshots,
//     run-dress-rehearsal, run-deploy-prod, supabase-staging, supabase-prod) and the
//     pipeline's reusable workflows they call (pipeline/.github/workflows/*.yml):
//     every `secrets.X` except the automatic GITHUB_TOKEN.
//   foundation-template/.stage/scripts/init-project.sh: sets STAGING_SUPABASE_URL and
//     STAGING_SUPABASE_PUBLISHABLE_KEY as GitHub secrets; Pages gets only the plain
//     (non-secret) env vars VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY; it
//     templates no Supabase function secrets (each project sets its own).
//   static-fastnachtlancaster-com/wrangler.jsonc and .dev.vars.example: the Worker's
//     one secret is TURNSTILE_SECRET_KEY; its .github/workflows/ci.yml uses no secrets.
export const REQUIRED_SECRETS_BY_SHAPE: {
  readonly app: Readonly<Record<'github' | 'pages' | 'supabase', readonly string[]>>
  readonly site: Readonly<Record<'github' | 'worker', readonly string[]>>
} = {
  app: {
    github: [
      'PROD_DB_PASSWORD',
      'PROD_PROJECT_REF',
      'PR_BOT_TOKEN',
      'SPD_API_TOKEN',
      'SPD_REHEARSAL_TOKEN',
      'STAGING_DB_PASSWORD',
      'STAGING_DB_URL',
      'STAGING_PROJECT_REF',
      'STAGING_SUPABASE_PUBLISHABLE_KEY',
      'STAGING_SUPABASE_URL',
      'SUPABASE_ACCESS_TOKEN',
    ],
    pages: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
    supabase: [],
  },
  site: {
    github: [],
    worker: ['TURNSTILE_SECRET_KEY'],
  },
}

/** Dotted keys a project must have, by kind and shape. */
export function requiredFor(kind: Kind, shape: Shape): readonly string[] {
  const keys = ['app.name', 'app.description', 'app.kind', 'app.shape']
  if (kind === 'live') {
    keys.push('github.org', 'github.repo')
    if (shape === 'app') keys.push('supabase.staging_ref', 'supabase.prod_ref')
    keys.push('cloudflare.account_id', 'cloudflare.project', 'cloudflare.type', 'env.staging.url', 'env.prod.url')
  }
  return keys
}

// ── Validation tables ────────────────────────────────────────────────────────

type Check = (v: unknown) => string | null

const str: Check = (v) => (typeof v === 'string' && v.trim() !== '' ? null : 'must be a non-empty string')
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'must be true or false')
const strList: Check = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '') ? null : 'must be a list of non-empty strings'
const matches = (re: RegExp, what: string): Check => (v) =>
  typeof v === 'string' && re.test(v) ? null : `must be ${what}`
const oneOf = (...allowed: string[]): Check => (v) =>
  typeof v === 'string' && allowed.includes(v) ? null : `must be one of: ${allowed.join(', ')}`
const url: Check = (v) => (typeof v === 'string' && /^https?:\/\/[^\s/]+/.test(v) ? null : 'must be an http(s) URL')

const SECTIONS: Record<string, Record<string, Check>> = {
  app: {
    name: matches(NAME_RE, 'a lowercase slug (letters, digits, single hyphens), for example "my-project"'),
    description: str,
    kind: oneOf('local', 'live'),
    shape: oneOf('app', 'site'),
  },
  github: { org: str, repo: str },
  supabase: {
    staging_ref: matches(SUPABASE_REF_RE, '20 lowercase letters'),
    prod_ref: matches(SUPABASE_REF_RE, '20 lowercase letters'),
  },
  cloudflare: {
    account_id: matches(CLOUDFLARE_ACCOUNT_RE, '32 lowercase hex characters'),
    project: str,
    type: oneOf('pages', 'worker'),
    domain: str,
  },
  companion: { repo: str, design: str },
  lanes: { dev_only: strList },
  gateway: { behaviour_paths: strList },
  rehearsal: { required: bool },
  layer: {
    kind: oneOf('foundation', 'angle', 'implementation', 'project'),
    angle: str,
    upstream: str,
  },
}
const ENV_NAMES = ['staging', 'prod']

// What version 2 refuses, with where the fact lives now.
const REFUSED_SECTIONS: Record<string, string> = {
  paths: 'delete it; the skeleton fixes these paths',
  ports: "delete it; the port slot lives in this machine's registry (~/.config/spd/projects.toml)",
  docker: "delete it; ports live in this machine's registry (~/.config/spd/projects.toml)",
  auth: 'delete it; local sign-in lives in supabase/config.toml',
  pipeline: "delete it; the lanes are the platform's, by shape",
  deploy: "delete it; the lanes are the platform's, by shape",
  container: 'delete it; version 2 has no container section',
  team: 'delete it; people and roles live on the platform',
  identity: 'delete it; version 2 has no identity section',
  client: 'delete it; version 2 has no client section',
  agents: 'delete it; agents are not recorded in the file',
  ai: 'delete it; version 2 has no ai section',
  lifecycle: 'delete it; kind (local | live) replaces the lifecycle',
  hetzner: 'delete it; version 2 has no hetzner section',
  routes: 'delete it; version 2 has no routes section',
  functions: 'delete it; version 2 has no functions section',
  testing: 'delete it; version 2 has no testing section',
}
const REFUSED_KEYS: Record<string, string> = {
  'app.display_name': 'delete it; the display name lives in design/brand.toml',
  'app.version': 'delete it; the version lives in package.json',
  'app.stack': 'delete it; version 2 does not record the stack',
  'cloudflare.zone_id': 'delete it; the platform records the zone',
  'cloudflare.pages_project': 'rename it to [cloudflare] project (and set type = "pages")',
}

// ── Parsing ──────────────────────────────────────────────────────────────────

type Table = Record<string, unknown>
const isTable = (v: unknown): v is Table => typeof v === 'object' && v !== null && !Array.isArray(v)

const err = (path: string, message: string, fix: string): Problem => ({ path, message, fix, severity: 'error' })

function checkSection(pathPrefix: string, value: unknown, checks: Record<string, Check>, problems: Problem[]): void {
  if (!isTable(value)) {
    problems.push(err(pathPrefix, `[${pathPrefix}] must be a table`, `write it as a [${pathPrefix}] table`))
    return
  }
  for (const [key, v] of Object.entries(value)) {
    const path = `${pathPrefix}.${key}`
    const refused = (Object.hasOwn(REFUSED_KEYS, path) ? REFUSED_KEYS[path] : undefined) ?? (path.startsWith('supabase.local_') ? 'delete it; local Supabase settings live in supabase/config.toml' : undefined)
    if (refused) {
      problems.push(err(path, `${path} is not allowed in version 2`, refused))
    } else if (!Object.hasOwn(checks, key)) {
      problems.push(err(path, `unknown key ${path}`, `delete ${key}, or check its spelling`))
    } else {
      const bad = checks[key](v)
      if (bad) problems.push(err(path, `${path} ${bad}`, `correct ${path}`))
    }
  }
}

function checkEnv(value: unknown, problems: Problem[]): void {
  if (!isTable(value)) {
    problems.push(err('env', '[env] must be a table', 'write [env.staging] and [env.prod] tables'))
    return
  }
  for (const [name, v] of Object.entries(value)) {
    const path = `env.${name}`
    if (!ENV_NAMES.includes(name)) {
      problems.push(err(path, `${path} is not allowed in version 2`, 'delete it; only [env.staging] and [env.prod] exist'))
    } else {
      checkSection(path, v, { url }, problems)
    }
  }
}

function has(raw: Table, dotted: string): boolean {
  let cur: unknown = raw
  for (const part of dotted.split('.')) {
    if (!isTable(cur) || !Object.hasOwn(cur, part)) return false
    cur = cur[part]
  }
  return true
}

const PLATFORM_FIX = 'spd config pull'

/**
 * Parse and validate an spd_config.toml. Unknown keys, refused keys, wrong types
 * and missing required keys are errors; `config` is null whenever any error exists
 * A version 1 file is read through `migrateV1` in memory and returned with
 * `version: 1` and a warning.
 *
 * `opts.projectRoot` is only read for a version 1 file (migrateV1 takes `shape` from
 * its folders); the schema never falls back to it (a missing name is an error,
 * never the folder's name).
 */
export function parseSpdConfig(
  text: string,
  opts?: { projectRoot?: string },
): { config: SpdConfigV2 | null; problems: Problem[]; version: 1 | 2 } {
  let raw: unknown
  try {
    raw = Bun.TOML.parse(text)
  } catch (e) {
    return {
      config: null,
      version: 2,
      problems: [err('', `spd_config.toml is not valid TOML: ${e instanceof Error ? e.message : String(e)}`, 'fix the TOML syntax')],
    }
  }
  if (!isTable(raw)) {
    return { config: null, version: 2, problems: [err('', 'spd_config.toml is not a table', 'fix the TOML syntax')] }
  }

  if (!Object.hasOwn(raw, 'schema')) {
    // Version 1: read it through migrateV1 in memory. An in-memory read never
    // refuses, so what migrateV1 refuses on becomes a warning.
    const projectRoot = opts?.projectRoot
    const m = migrateV1(text, projectRoot ?? '', null)
    const warn = (path: string, message: string, fix: string): Problem => ({ severity: 'warn', path, message, fix })
    const head: Problem[] = [
      warn('schema', 'spd_config.toml is version 1', 'spd config migrate'),
      ...(projectRoot ? [] : [warn('app.shape', 'no project folder was given, so app.shape defaults to "app"', 'pass the project folder, or run spd config migrate')]),
      ...m.refused.map((r) => warn('', r, 'resolve the difference, then run spd config migrate')),
    ]
    let migrated: unknown
    try {
      migrated = Bun.TOML.parse(m.text)
    } catch (e) {
      return { config: null, version: 1, problems: [...head, err('', `the migrated text is not valid TOML: ${e instanceof Error ? e.message : String(e)}`, 'fix the TOML syntax')] }
    }
    if (!isTable(migrated)) return { config: null, version: 1, problems: [...head, err('', 'spd_config.toml is not a table', 'fix the TOML syntax')] }
    // A file with no kind is read as live (the census already does), so it is held to what live needs.
    const extra: Problem[] = []
    if (isTable(migrated.app) && !Object.hasOwn(migrated.app, 'kind')) {
      migrated.app.kind = 'live'
      extra.push(warn('app.kind', 'app.kind is missing, so this file is read as "live"', 'add kind to [app]'))
    }
    const inner = validateV2(migrated)
    // Only the facts the platform fills are downgraded; [app] is the file's own (a missing name stays an error).
    const isRequired = (p: Problem) =>
      p.severity === 'error' && / is required\b/.test(p.message) && (!p.path.startsWith('app.') || p.path === 'app.description')
    // A present section missing keys is left out of the config; the platform fills it.
    const leftOut = new Set<string>()
    const sectionOf = (path: string): string | null => {
      const [a, b] = path.split('.')
      if (a === 'env' && ENV_NAMES.includes(b)) return `env.${b}`
      return ['github', 'supabase', 'cloudflare', 'companion', 'layer'].includes(a) && isTable(migrated[a]) ? a : null
    }
    for (const p of inner.problems) {
      if (!isRequired(p)) continue
      const sec = sectionOf(p.path)
      if (sec && has(migrated, sec)) leftOut.add(sec)
    }
    const problems: Problem[] = []
    for (const p of inner.problems) {
      if (!isRequired(p)) { problems.push(p); continue }
      const sec = sectionOf(p.path)
      if (sec && leftOut.has(sec)) continue
      problems.push(p.path === 'app.description'
        ? warn('app.description', 'app.description is missing, so it is read as ""', 'write a description in [app] description')
        : { ...p, severity: 'warn' })
    }
    for (const sec of leftOut) {
      const missing = inner.problems.filter((p) => isRequired(p) && sectionOf(p.path) === sec).map((p) => p.path.slice(sec.length + 1))
      problems.push(warn(sec, `[${sec}] is incomplete (missing ${missing.join(', ')}) and is left out of this read`, PLATFORM_FIX))
    }
    const clean = problems
    const hasErrors = clean.some((p) => p.severity === 'error')
    let config: SpdConfigV2 | null = null
    if (!hasErrors) {
      const copy = structuredClone(migrated) as Table
      if (isTable(copy.app) && !Object.hasOwn(copy.app, 'description')) copy.app.description = ''
      for (const sec of leftOut) {
        const [a, b] = sec.split('.')
        if (b && isTable(copy[a])) delete (copy[a] as Table)[b]
        else delete copy[a]
      }
      config = copy as unknown as SpdConfigV2
    }
    return { config, version: 1, problems: [...head, ...extra, ...clean] }
  }

  return validateV2(raw)
}

/** Check a parsed document against the version 2 schema. */
function validateV2(raw: Table): { config: SpdConfigV2 | null; problems: Problem[]; version: 1 | 2 } {
  const problems: Problem[] = []
  if (raw.schema !== SCHEMA_VERSION) {
    problems.push(err('schema', `schema must be ${SCHEMA_VERSION}`, `set schema = ${SCHEMA_VERSION}`))
  }

  for (const [section, value] of Object.entries(raw)) {
    if (section === 'schema') continue
    if (section === 'env') checkEnv(value, problems)
    else if (Object.hasOwn(SECTIONS, section)) checkSection(section, value, SECTIONS[section], problems)
    else if (Object.hasOwn(REFUSED_SECTIONS, section)) {
      problems.push(err(section, `[${section}] is not allowed in version 2`, REFUSED_SECTIONS[section]))
    } else {
      problems.push(err(section, `unknown section [${section}]`, `delete [${section}], or check its spelling`))
    }
  }

  const app = isTable(raw.app) ? raw.app : {}
  const kind = app.kind === 'live' ? 'live' : 'local'
  const shape = app.shape === 'site' ? 'site' : 'app'
  const seen = new Set(problems.map((p) => p.path))
  for (const key of requiredFor(kind, shape)) {
    if (has(raw, key) || seen.has(key) || seen.has(key.split('.')[0])) continue
    problems.push(err(key, `${key} is required${key.startsWith('app.') ? '' : ' for a live project'}`,
      key.startsWith('app.') ? `add ${key.split('.')[1]} to [app]` : PLATFORM_FIX))
  }

  // A section that is present must carry its non-optional fields.
  const WHEN_PRESENT: Record<string, string[]> = {
    layer: ['kind'],
    companion: ['repo'],
    github: ['org', 'repo'],
    supabase: ['staging_ref', 'prod_ref'],
    cloudflare: ['account_id', 'project', 'type'],
  }
  const present = (k: string) => has(raw, k) || problems.some((p) => p.path === k)
  for (const [section, keys] of Object.entries(WHEN_PRESENT)) {
    if (!Object.hasOwn(raw, section) || !isTable(raw[section])) continue
    for (const k of keys) {
      const key = `${section}.${k}`
      if (!present(key)) problems.push(err(key, `${key} is required when [${section}] is present`, `add ${k} to [${section}]`))
    }
  }
  if (isTable(raw.env)) {
    for (const name of ENV_NAMES) {
      const key = `env.${name}.url`
      if (Object.hasOwn(raw.env, name) && isTable(raw.env[name]) && !present(key)) {
        problems.push(err(key, `${key} is required when [env.${name}] is present`, `add url to [env.${name}]`))
      }
    }
  }

  const companion = isTable(raw.companion) ? raw.companion : undefined
  if (companion && Object.hasOwn(companion, 'design') && shape !== 'site' && !seen.has('companion.design')) {
    problems.push(err('companion.design', 'companion.design is only for a site', 'delete design from [companion]'))
  }

  const hasErrors = problems.some((p) => p.severity === 'error')
  return { config: hasErrors ? null : (raw as unknown as SpdConfigV2), problems, version: 2 }
}

/** Read a scalar or list by dotted key, for example `supabase.staging_ref`. */
export function getKey(config: SpdConfigV2, dotted: string): string | number | boolean | string[] | undefined {
  let cur: unknown = config
  for (const part of dotted.split('.')) {
    if (!isTable(cur) || !Object.hasOwn(cur, part)) return undefined
    cur = cur[part]
  }
  if (typeof cur === 'string' || typeof cur === 'number' || typeof cur === 'boolean') return cur
  if (Array.isArray(cur) && cur.every((x) => typeof x === 'string')) return cur as string[]
  return undefined
}

// ── Version 1 → 2 ────────────────────────────────────────────────────────────

interface Entry {
  start: number
  end: number // inclusive; a key's value may span lines
  type: 'blank' | 'comment' | 'header' | 'key'
  path: string // header: the table path; key: the full dotted path
  section: string // the table a key sits in
  key: string
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const splitPath = (s: string) => s.split('.').map((x) => x.trim().replace(/^["']|["']$/g, ''))

function scanEntries(lines: string[]): Entry[] {
  const out: Entry[] = []
  let section = ''
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') { out.push({ start: i, end: i, type: 'blank', path: '', section, key: '' }); continue }
    if (line.trim().startsWith('#')) { out.push({ start: i, end: i, type: 'comment', path: '', section, key: '' }); continue }
    const h = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line)
    if (h) {
      section = splitPath(h[1]).join('.')
      out.push({ start: i, end: i, type: 'header', path: section, section, key: '' })
      continue
    }
    const k = /^\s*((?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*'))*)\s*=(.*)$/.exec(line)
    if (!k) { out.push({ start: i, end: i, type: 'comment', path: '', section, key: '' }); continue }
    // Follow a value over lines: open brackets, or an open triple-quoted string.
    let depth = 0
    let triple = ''
    let end = i
    for (let j = i; j < lines.length; j++) {
      const text = j === i ? k[2] : lines[j]
      let q = ''
      for (let c = 0; c < text.length; c++) {
        const ch = text[c]
        if (triple) {
          if (text.startsWith(triple, c)) { triple = ''; c += 2 }
        } else if (q) {
          if (ch === '\\' && q === '"') c++
          else if (ch === q) q = ''
        } else if (ch === '"' || ch === "'") {
          if (text.startsWith(ch.repeat(3), c)) { triple = ch.repeat(3); c += 2 } else q = ch
        } else if (ch === '#') break
        else if (ch === '[' || ch === '{') depth++
        else if (ch === ']' || ch === '}') depth--
      }
      end = j
      if (depth <= 0 && !triple) break
    }
    const key = splitPath(k[1]).join('.')
    out.push({ start: i, end, type: 'key', path: section ? `${section}.${key}` : key, section, key })
    i = end
  }
  return out
}

const KEPT_KEYS = new Set<string>([
  ...Object.entries(SECTIONS).flatMap(([sec, keys]) => Object.keys(keys).map((k) => `${sec}.${k}`)),
  ...ENV_NAMES.map((n) => `env.${n}.url`),
])

/**
 * Turn a version 1 spd_config.toml into version 2. Pure: text in, text out. It
 * reads only `projectRoot`'s top-level folders (`supabase/`, to set `shape`) and
 * `design/brand.toml` (to check `display_name`); with `projectRoot` '' it reads
 * nothing and sets `shape = "app"`. It keeps the comments on the lines it keeps.
 *
 * `moved` names what was renamed or set, `dropped` what version 2 refuses (or
 * does not know). `refused` is non-empty when a value it would drop disagrees
 * with where that fact lives now: the caller then writes nothing. The text is
 * returned either way, so an in-memory read can still use it.
 */
export function migrateV1(
  text: string,
  projectRoot: string,
  registrySlot: number | null,
): { text: string; moved: string[]; dropped: string[]; refused: string[] } {
  const moved: string[] = []
  const dropped: string[] = []
  const refused: string[] = []

  let raw: unknown
  try {
    raw = Bun.TOML.parse(text)
  } catch (e) {
    return { text, moved, dropped, refused: [`spd_config.toml is not valid TOML: ${e instanceof Error ? e.message : String(e)}`] }
  }
  const doc: Table = isTable(raw) ? raw : {}
  if (Object.hasOwn(doc, 'schema')) return { text, moved, dropped, refused }

  const lines = text.split('\n')
  const entries = scanEntries(lines)

  // ── What disagrees with its new home ──
  const ports = isTable(doc.ports) ? doc.ports : undefined
  if (ports && typeof ports.slot === 'number' && registrySlot !== null && ports.slot !== registrySlot) {
    refused.push(`[ports] slot is ${ports.slot} here but ${registrySlot} in this machine's registry (~/.config/spd/projects.toml); make them agree, then migrate`)
  }
  const appIn = isTable(doc.app) ? doc.app : {}
  if (typeof appIn.display_name === 'string' && projectRoot) {
    const brandPath = join(projectRoot, 'design', 'brand.toml')
    try {
      if (existsSync(brandPath)) {
        const brand = Bun.TOML.parse(readFileSync(brandPath, 'utf8'))
        if (isTable(brand) && typeof brand.name === 'string' && brand.name !== appIn.display_name) {
          refused.push(`[app] display_name is "${appIn.display_name}" but design/brand.toml name is "${brand.name}"; make them agree, then migrate`)
        }
      }
    } catch {
      // an unreadable brand file has nothing to disagree with
    }
  }

  // ── Which keys and headers stay ──
  const cloudflare = isTable(doc.cloudflare) ? doc.cloudflare : {}
  if (Object.hasOwn(cloudflare, 'project') && Object.hasOwn(cloudflare, 'pages_project') && cloudflare.project !== cloudflare.pages_project) {
    refused.push(`[cloudflare] pages_project is ${JSON.stringify(cloudflare.pages_project)} but project is ${JSON.stringify(cloudflare.project)}; make them agree, then migrate`)
  }
  // An inline table or dotted key above a kept key cannot be dropped whole, and cannot be edited line by line.
  const KEEP_PREFIXES = [...KEPT_KEYS, 'cloudflare.pages_project']
  const holdsKept = (path: string): boolean => KEEP_PREFIXES.some((k) => k.startsWith(`${path}.`))
  const renames = new Set<number>() // entry indexes of pages_project lines
  const keepKey = (e: Entry): boolean => KEPT_KEYS.has(e.path) || (e.path === 'cloudflare.pages_project' && !Object.hasOwn(cloudflare, 'project'))
  const keptHeaders = new Set<string>(['app'])
  const keysOf = new Map<string, number>()
  for (const e of entries) {
    if (e.type !== 'key') continue
    keysOf.set(e.section, (keysOf.get(e.section) ?? 0) + 1)
    if (keepKey(e) || holdsKept(e.path)) keptHeaders.add(e.section)
  }
  const remove = new Array<boolean>(lines.length).fill(false)
  const dropRange = (from: number, to: number) => { for (let i = from; i <= to; i++) remove[i] = true }
  // The comment lines directly above an entry (no blank between) are its own.
  const bannerStart = (idx: number): number => {
    let b = idx
    while (b > 0 && entries[b - 1].type === 'comment') b--
    return entries[b].start
  }
  // A dropped header also takes a "# ── Title" comment block set apart from it by blank lines.
  const headerBannerStart = (idx: number): number => {
    let b = idx
    while (b > 0 && entries[b - 1].type === 'comment') b--
    let g = b
    while (g > 0 && entries[g - 1].type === 'blank') g--
    if (g === b || g === 0 || entries[g - 1].type !== 'comment') return entries[b].start
    let c = g
    while (c > 0 && entries[c - 1].type === 'comment') c--
    return lines[entries[c].start].trimStart().startsWith('# ──') ? entries[c].start : entries[b].start
  }

  let lastAppIdx = -1
  let appHeaderIdx = -1
  entries.forEach((e, idx) => {
    if (e.type === 'header') {
      if (e.path === 'app') appHeaderIdx = idx
      if (!keptHeaders.has(e.path)) {
        dropRange(headerBannerStart(idx), e.start)
        if (keysOf.has(e.path) || e.path !== 'env') dropped.push(`[${e.path}]`)
      }
    } else if (e.type === 'key') {
      if (keepKey(e)) {
        if (e.section === 'app') lastAppIdx = idx
        if (e.path === 'cloudflare.pages_project') renames.add(idx)
      } else if (holdsKept(e.path)) {
        refused.push(`${e.path} holds keys version 2 keeps, but is written as an inline table or dotted key; rewrite [${e.path}] as a table, then migrate`)
      } else {
        dropRange(bannerStart(idx), e.end)
        if (keptHeaders.has(e.section) || e.section === '') dropped.push(e.path)
      }
    }
  })

  // ── Rewrite ──
  const after = new Map<number, string[]>() // insert lines after line index
  const addAfter = (line: number, ...add: string[]) => after.set(line, [...(after.get(line) ?? []), ...add])
  const edited = [...lines]
  entries.forEach((e, idx) => {
    if (!renames.has(idx)) return
    const m = /^(\s*)(\S.*?)(\s*)=/.exec(lines[e.start])
    if (!m) {
      refused.push(`cloudflare.pages_project on line ${e.start + 1} could not be read; rename it to project by hand, then migrate`)
      return
    }
    const SPELLING = /(?:"pages_project"|'pages_project'|pages_project)$/
    const newKey = m[2].replace(SPELLING, 'project')
    const keyPad = ' '.repeat(Math.max(1, m[2].length + m[3].length - newKey.length))
    edited[e.start] = `${m[1]}${newKey}${keyPad}${lines[e.start].slice(m[0].length - 1)}`
    moved.push('cloudflare.pages_project -> cloudflare.project')
    if (!Object.hasOwn(cloudflare, 'type')) {
      const typeKey = m[2].replace(SPELLING, 'type')
      const typePad = ' '.repeat(Math.max(1, m[2].length + m[3].length - typeKey.length))
      addAfter(e.end, `${m[1]}${typeKey}${typePad}= "pages"`)
      moved.push('cloudflare.type set to "pages"')
    }
  })

  const shape = projectRoot && !isDir(join(projectRoot, 'supabase')) ? 'site' : 'app'
  let appendApp = false
  if (!Object.hasOwn(appIn, 'shape')) {
    if (lastAppIdx >= 0) {
      const km = /^(\s*)(\S+?)(\s*)=/.exec(lines[entries[lastAppIdx].start])
      const width = km ? km[2].length + km[3].length : 'shape'.length + 1
      addAfter(entries[lastAppIdx].end, `${km ? km[1] : ''}shape${' '.repeat(Math.max(1, width - 'shape'.length))}= "${shape}"`)
    }
    else if (appHeaderIdx >= 0) addAfter(entries[appHeaderIdx].end, `shape = "${shape}"`)
    else appendApp = true
    moved.push(`app.shape set to "${shape}"${projectRoot ? (shape === 'site' ? ' (no supabase/ folder)' : ' (supabase/ folder present)') : ' (no project folder given)'}`)
  }

  const out: string[] = ['schema = 2', '']
  for (let i = 0; i < edited.length; i++) {
    if (!remove[i]) out.push(edited[i])
    for (const l of after.get(i) ?? []) if (!remove[i]) out.push(l)
  }
  if (appendApp) out.push('', '[app]', `shape = "${shape}"`)
  // Collapse the blank runs that removals leave, and trim the end.
  const collapsed: string[] = []
  for (const l of out) {
    if (l.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue
    collapsed.push(l)
  }
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') collapsed.pop()

  return { text: collapsed.join('\n') + '\n', moved, dropped: [...new Set(dropped)], refused }
}
// ── CLI (not part of the hashed copy) ──
// The command line under every copy of spdConfig.ts (foundation-template and pipeline).
//
// Not hashed. `make sync-spd-config` drops the import lines below and appends the rest after the
// marker line of the copy, where parseSpdConfig, getKey, readFileSync and join are already in scope.


function runSpdConfigCli(argv: string[]): number {
  const fileAt = argv.indexOf('--file')
  const file = fileAt === -1 ? 'spd_config.toml' : (argv[fileAt + 1] ?? '')
  const rest = fileAt === -1 ? argv : argv.filter((_, i) => i !== fileAt && i !== fileAt + 1)
  const [command, key] = rest
  if ((command !== 'get' || !key) && command !== 'check') {
    console.error('usage: spd-config.ts get <dotted.key> | check   [--file <spd_config.toml>]')
    return 1
  }
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    console.error(`cannot read ${file}`)
    return 1
  }
  const { config, problems } = parseSpdConfig(text, { projectRoot: join(file, '..') })
  const line = (p: { severity: string; message: string; fix: string }) => `${p.severity}: ${p.message} (${p.fix})`
  if (command === 'check') {
    for (const p of problems) console.log(line(p))
    return problems.some((p) => p.severity === 'error') ? 1 : 0
  }
  if (!config) {
    for (const p of problems.filter((x) => x.severity === 'error')) console.error(line(p))
    return 1
  }
  const value = getKey(config, key as string)
  if (value === undefined) {
    console.error(`${key} is not set in ${file}`)
    return 1
  }
  console.log(Array.isArray(value) ? value.join('\n') : String(value))
  return 0
}

if (import.meta.main) process.exit(runSpdConfigCli(process.argv.slice(2)))
