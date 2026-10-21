import { describe, expect, test } from 'bun:test'
import { DEFAULT_PLAYWRIGHT, playwrightImage, playwrightOutputs, playwrightVersion } from './playwrightImage.ts'

const lock = (core: string) => `{
  "packages": {
    "@playwright/test": ["@playwright/test@1.61.1", "", { "dependencies": { "playwright": "1.61.1" } }, "sha512-x"],
    "playwright-core": ["playwright-core@${core}", "", { "bin": { "playwright-core": "cli.js" } }, "sha512-y"],
  }
}`

describe('playwrightVersion', () => {
  test('reads playwright-core, else @playwright/test', () => {
    expect(playwrightVersion(lock('1.61.0'))).toBe('1.61.0')
    expect(playwrightVersion('"@playwright/test": ["@playwright/test@1.55.2", ""]')).toBe('1.55.2')
    expect(playwrightVersion('{}')).toBeNull()
  })
  test('refuses anything but plain digits: the value goes into an image name', () => {
    expect(playwrightVersion(lock('1.61.0-beta'))).toBeNull()
    expect(playwrightVersion(lock('1.61.0 ; curl evil'))).toBeNull()
    expect(playwrightVersion(lock('1.61.0@sha256:abc'))).toBeNull()
    expect(() => playwrightImage('latest')).toThrow()
  })
})

describe('playwrightOutputs', () => {
  test('the matching image, or the default with the browser installed', () => {
    expect(playwrightOutputs(lock('1.61.0'))).toEqual({ playwright_image: 'mcr.microsoft.com/playwright:v1.61.0-noble', playwright_matched: 'true' })
    expect(playwrightOutputs(null)).toEqual({ playwright_image: `mcr.microsoft.com/playwright:v${DEFAULT_PLAYWRIGHT}-noble`, playwright_matched: 'false' })
  })
})
