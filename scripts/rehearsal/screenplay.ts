// scripts/rehearsal/screenplay.ts — read a project's screenplay/ directory.
// Ported from client/cli/src/commands/screenplay.ts (parseScenarios,
// collectCastEntries) so the rehearsal and the dashboard read scenes the
// same way. One change: tags above Feature: and Rule: are inherited by the
// scenarios beneath them, as Gherkin defines (so @later on a feature marks
// every scenario in it).
import fs from 'node:fs'
import path from 'node:path'

export interface ScriptStep { keyword: string; text: string }
export interface ScriptScenario { name: string; tags: string[]; steps: ScriptStep[] }

export interface CastEntry {
  kind: 'persona' | 'setting' | 'scene'
  file_path: string
  name: string
  discipline: string | null
  summary: string
  tags?: string[]
  scenario_count?: number
  scenarios?: ScriptScenario[]
  actor_key?: string
  role?: string | null
  device?: string | null
  avatar_path?: string
  avatar_url?: string | null
}

const STEP_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But']

export function parseScenarios(content: string): ScriptScenario[] {
  const out: ScriptScenario[] = []
  let current: ScriptScenario | null = null
  let pendingTags: string[] = []
  let featureTags: string[] = []
  let ruleTags: string[] = []
  let inDocString = false
  const featureBackground: ScriptStep[] = []
  let ruleBackground: ScriptStep[] = []
  let inRule = false
  let background: ScriptStep[] | null = null
  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('"""') || line.startsWith('```')) { inDocString = !inDocString; continue }
    if (inDocString || line === '' || line.startsWith('#')) continue
    if (line.startsWith('@')) { pendingTags.push(...(line.match(/@[\w-]+/g) ?? [])); continue }
    const m = line.match(/^(Scenario Outline|Scenario|Example):\s*(.+)$/)
    if (m) {
      current = {
        name: m[2].trim(),
        tags: [...new Set([...featureTags, ...ruleTags, ...pendingTags])],
        steps: [...featureBackground, ...ruleBackground],
      }
      background = null
      pendingTags = []
      out.push(current)
      continue
    }
    const section = line.match(/^(Feature|Background|Rule|Examples|Scenarios):/)
    if (section) {
      if (section[1] === 'Feature') featureTags = [...pendingTags]
      if (section[1] === 'Rule') { inRule = true; ruleBackground = []; ruleTags = [...pendingTags] }
      current = null; pendingTags = []; background = null
      if (section[1] === 'Background') background = inRule ? ruleBackground : featureBackground
      continue
    }
    const kw = STEP_KEYWORDS.find(k => line.startsWith(k + ' ') || line === k)
    if (!kw) continue
    const step = { keyword: kw, text: line.slice(kw.length).trim() }
    if (current) current.steps.push(step)
    else if (background) background.push(step)
  }
  return out
}

/** A regular file, never a symlink (a symlink could point outside screenplay/). */
function isRegularFile(p: string): boolean {
  try { return fs.lstatSync(p).isFile() } catch { return false }
}

function listMarkdownRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listMarkdownRecursive(full))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)   // isFile() is false for a symlink
  }
  return out
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string> | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: null, body: content }
  const fm: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
    if (kv) fm[kv[1]] = kv[2]
  }
  return { frontmatter: fm, body: match[2] }
}

function summarize(body: string, max = 280): string {
  const cleaned = body.trim().replace(/\s+/g, ' ')
  return cleaned.length > max ? `${cleaned.slice(0, max).trimEnd()}…` : cleaned
}

function personaIdentity(fm: Record<string, string> | null, personaDir: string) {
  const actor_key = (fm?.env_prefix ?? personaDir.split('-')[0]).toLowerCase()
  const name = fm?.name ?? actor_key.charAt(0).toUpperCase() + actor_key.slice(1)
  return { actor_key, name, role: fm?.role ?? null, device: fm?.device ?? null }
}

export function collectCastEntries(screenplayRoot: string): CastEntry[] {
  const entries: CastEntry[] = []
  const rel = (full: string) => path.relative(path.dirname(screenplayRoot), full).split(path.sep).join('/')

  const collect = (dir: string, kind: 'persona' | 'setting') => {
    for (const full of listMarkdownRecursive(dir).filter(f => !f.endsWith('README.md'))) {
      const { frontmatter, body } = parseFrontmatter(fs.readFileSync(full, 'utf8'))
      const isSettings = path.basename(full, '.md') === 'account_settings'
      const base = isSettings ? path.basename(path.dirname(full)) : path.basename(full, '.md')
      if (kind === 'persona') {
        const avatar = path.join(path.dirname(full), 'avatar.svg')
        entries.push({
          kind, file_path: rel(full), discipline: frontmatter?.discipline ?? null, summary: summarize(body),
          ...personaIdentity(frontmatter, base),
          avatar_path: isSettings && isRegularFile(avatar) ? avatar : undefined,
        })
      } else {
        entries.push({
          kind, file_path: rel(full), name: frontmatter?.name ?? frontmatter?.persona ?? base,
          discipline: frontmatter?.discipline ?? null, summary: summarize(body),
        })
      }
    }
  }
  collect(path.join(screenplayRoot, 'personae'), 'persona')
  collect(path.join(screenplayRoot, 'setting'), 'setting')

  const featuresDir = path.join(screenplayRoot, 'features')
  if (fs.existsSync(featuresDir)) {
    for (const file of fs.readdirSync(featuresDir).filter(f => f.endsWith('.feature')).sort()) {
      const full = path.join(featuresDir, file)
      if (!isRegularFile(full)) continue
      const content = fs.readFileSync(full, 'utf8')
      const scenarios = parseScenarios(content)
      const descMatch = content.match(/^Feature:.*\n([\s\S]*?)(?=\n\s*(Background|Scenario|Rule|@))/m)
      entries.push({
        kind: 'scene', file_path: rel(full),
        name: content.match(/^\s*Feature:\s*(.+)/m)?.[1]?.trim() ?? file.replace('.feature', ''),
        discipline: null, summary: summarize(descMatch?.[1] ?? ''),
        tags: [...new Set(content.match(/@[\w-]+/g) ?? [])],
        scenario_count: scenarios.length, scenarios,
      })
    }
  }
  return entries
}
