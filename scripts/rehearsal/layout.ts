// scripts/rehearsal/layout.ts — where a project keeps its machinery and its cast.
// New projects: .stage/ (config, scripts) and screenplay/cast/. Older projects
// keep playwright.config.ts and scripts/ at the root and personae/ beside screenplay/.
import fs from 'node:fs'
import path from 'node:path'

function firstExisting(root: string, candidates: string[]): string | null {
  return candidates.find(c => fs.existsSync(path.join(root, c))) ?? null
}

/** Relative path to the project's Playwright config, or null if it has none. */
export function playwrightConfigFor(root: string): string | null {
  return firstExisting(root, ['.stage/config/playwright.config.ts', 'playwright.config.ts'])
}

/** Relative path to a project script (.stage/scripts/ first, then scripts/), or null. */
export function stageScript(root: string, file: string): string | null {
  return firstExisting(root, [`.stage/scripts/${file}`, `scripts/${file}`])
}

/** Absolute path to the cast: screenplay/cast, else personae, else screenplay/personae. */
export function castDirFor(projectRoot: string): string {
  const preferred = path.join(projectRoot, 'screenplay', 'cast')
  const found = ['screenplay/cast', 'personae', 'screenplay/personae']
    .map(c => path.join(projectRoot, c))
    .find(d => fs.existsSync(d))
  return found ?? preferred
}
