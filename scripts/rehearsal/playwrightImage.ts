/**
 * playwrightImage.ts — the Playwright container the scenes run in.
 *
 * The perform job runs inside Microsoft's Playwright image, which carries
 * Chromium and every system library it needs, so no run spends a minute or
 * two on `playwright install --with-deps`. The image must match the
 * project's own Playwright exactly, so the version is read from its bun.lock
 * (as text: no project code runs in the start job). bun.lock is the
 * project's, so the version is accepted only as plain digits before it goes
 * into an image name.
 *
 * No version found (no bun.lock, or no Playwright in it): the default image,
 * and perform installs the project's own browser into it as before.
 */

export const DEFAULT_PLAYWRIGHT = '1.61.1'
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/

/** playwright-core's resolved version in a bun.lock, or null. */
export function playwrightVersion(lock: string): string | null {
  const m = lock.match(/"playwright-core":\s*\["playwright-core@([^"]+)"/)
    ?? lock.match(/"@playwright\/test":\s*\["@playwright\/test@([^"]+)"/)
  const v = m?.[1] ?? null
  return v && VERSION.test(v) ? v : null
}

export function playwrightImage(version: string): string {
  if (!VERSION.test(version)) throw new Error(`not a Playwright version: ${version}`)
  return `mcr.microsoft.com/playwright:v${version}-noble`
}

/** The start job's outputs: the image, and whether perform must install the browser itself. */
export function playwrightOutputs(lock: string | null): { playwright_image: string; playwright_matched: 'true' | 'false' } {
  const v = lock ? playwrightVersion(lock) : null
  return { playwright_image: playwrightImage(v ?? DEFAULT_PLAYWRIGHT), playwright_matched: v ? 'true' : 'false' }
}
