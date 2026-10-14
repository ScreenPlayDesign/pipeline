// scripts/rehearsal/config.ts — what the rehearsal needs from spd_config.toml.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RehearsalConfig { slug: string; stagingUrl: string }

export function readProjectConfig(root: string): RehearsalConfig {
  const raw = Bun.TOML.parse(readFileSync(join(root, 'spd_config.toml'), 'utf8')) as {
    app?: { name?: string }
    env?: { staging?: { url?: string } }
  }
  const slug = raw.app?.name
  const stagingUrl = raw.env?.staging?.url
  if (!slug) throw new Error('spd_config.toml has no [app] name')
  if (!stagingUrl) throw new Error('spd_config.toml has no [env.staging] url')
  return { slug, stagingUrl: stagingUrl.replace(/\/$/, '') }
}

/** The project checkout. Workflows run pipeline code from outside it and pass it in. */
export function projectRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROJECT_ROOT || process.cwd()
}
