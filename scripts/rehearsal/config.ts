// scripts/rehearsal/config.ts — what the rehearsal needs from spd_config.toml.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getKey, parseSpdConfig } from '../spd-config.ts'

export interface RehearsalConfig { slug: string; stagingUrl: string }

/** Reads spd_config.toml through spd-config.ts, the one reader (a version 1 file loads through its in-memory migration). */
export function readProjectConfig(root: string): RehearsalConfig {
  const file = join(root, 'spd_config.toml')
  const { config, problems } = parseSpdConfig(readFileSync(file, 'utf8'), { projectRoot: root })
  if (!config) {
    const errors = problems.filter((p) => p.severity === 'error').map((p) => `${p.message} (${p.fix})`)
    throw new Error(`spd_config.toml cannot be read: ${errors.join('; ')}`)
  }
  const slug = getKey(config, 'app.name')
  const stagingUrl = getKey(config, 'env.staging.url')
  if (typeof slug !== 'string' || !slug) throw new Error('spd_config.toml has no [app] name')
  if (typeof stagingUrl !== 'string' || !stagingUrl) throw new Error('spd_config.toml has no [env.staging] url')
  return { slug, stagingUrl: stagingUrl.replace(/\/$/, '') }
}

/** The project checkout. Workflows run pipeline code from outside it and pass it in. */
export function projectRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROJECT_ROOT || process.cwd()
}
