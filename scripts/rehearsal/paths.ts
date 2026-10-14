// scripts/rehearsal/paths.ts — the verdict job reads evidence the project's
// own run produced. A manifest or report could name any path; only regular
// files that really live under an allowed root may be read.
import { lstatSync, realpathSync } from 'node:fs'
import { sep } from 'node:path'

export function insideAny(roots: string[], p: string): boolean {
  let real: string
  try {
    if (!lstatSync(p).isFile()) return false   // a symlink (or anything else) is not a regular file
    real = realpathSync(p)
  } catch { return false }
  return roots.some(r => {
    let rr: string
    try { rr = realpathSync(r) } catch { return false }
    return real.startsWith(rr + sep)
  })
}
