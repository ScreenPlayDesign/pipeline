// scripts/rehearsal/report.ts — reading Playwright's JSON report. The shapes
// and helpers follow foundation-template/scripts/post-spd-results.ts.
import type { RunTest, TestStatus } from './verdict.ts'

export interface Attachment { name: string; path?: string; body?: string; contentType: string }
export interface PlaywrightResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted'
  duration: number
  error?: { message: string }
  attachments: Attachment[]
  annotations?: Array<{ type: string }>
}
export interface PlaywrightSpec {
  title: string
  ok: boolean
  tags?: string[]
  tests: Array<{ projectName?: string; status?: string; annotations?: Array<{ type: string }>; results: PlaywrightResult[] }>
}
export interface PlaywrightSuite { title: string; file?: string; suites?: PlaywrightSuite[]; specs?: PlaywrightSpec[] }
export interface PlaywrightReport { stats: { expected: number; unexpected: number; skipped: number }; suites: PlaywrightSuite[] }

export interface ReportTest extends RunTest { spec: PlaywrightSpec; rawTitle: string }

export function slugify(input: string): string {
  return input.replace(/@[\w-]+/g, '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'scenario'
}

const GHERKIN_KEYWORDS = ['Given', 'When', 'Then', 'And', 'But']
export function splitKeyword(title: string): { keyword: string; text: string } {
  const first = title.trim().split(/\s+/, 1)[0] ?? ''
  return GHERKIN_KEYWORDS.includes(first)
    ? { keyword: first, text: title.trim().slice(first.length).trim() }
    : { keyword: '', text: title.trim() }
}

// eslint-disable-next-line no-control-regex -- ESC is exactly what ANSI codes start with
export const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '')

export function featureFileFor(specFile: string): string {
  return `screenplay/features/${(specFile.split('/').pop() ?? specFile).replace(/\.spec\.[jt]s$/, '.feature')}`
}

// The result that decides the test: each project's last attempt, preferring
// a failure, then a pass, over a skip.
export function finalResult(spec: PlaywrightSpec): PlaywrightResult | undefined {
  const finals = (spec.tests ?? []).map(t => t.results[t.results.length - 1]).filter((r): r is PlaywrightResult => !!r)
  return finals.find(r => r.status !== 'passed' && r.status !== 'skipped')
    ?? finals.find(r => r.status === 'passed')
    ?? finals[0]
}

export function testStatus(spec: PlaywrightSpec): TestStatus {
  const fixme = (spec.tests ?? []).some(t =>
    (t.annotations ?? []).some(a => a.type === 'fixme')
    || t.results.some(r => (r.annotations ?? []).some(a => a.type === 'fixme')))
  if (fixme) return 'fixme'
  const r = finalResult(spec)
  if (r?.status === 'passed') return 'passed'
  if (r?.status === 'skipped') return 'skipped'
  return 'failed'
}

function flatten(suite: PlaywrightSuite, file = suite.file ?? suite.title): Array<{ file: string; spec: PlaywrightSpec }> {
  return [
    ...(suite.specs ?? []).map(spec => ({ file, spec })),
    ...(suite.suites ?? []).flatMap(child => flatten(child, child.file ?? file)),
  ]
}

export function runTestsFrom(report: PlaywrightReport): ReportTest[] {
  return report.suites.flatMap(s => flatten(s)).map(({ file, spec }) => ({
    featureFile: featureFileFor(file),
    title: spec.title.replace(/@[\w-]+\s*/g, '').trim() || spec.title,
    rawTitle: spec.title,
    status: testStatus(spec),
    spec,
  }))
}
