// scripts/rehearsal/png.ts — is a Playwright screenshot one solid colour?
// A scene that performs on its actors' own browsers never uses the test's own
// page, so Playwright's final screenshot and video of that page are blank.
// Only 8-bit, non-interlaced PNGs (what Playwright writes) are judged; any
// other file is reported as not blank, so real evidence is never dropped.
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

export function isBlankPng(path: string): boolean {
  let buf: Buffer
  try { buf = readFileSync(path) } catch { return false }
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return false
  let width = 0, height = 0, depth = 0, colorType = -1, interlace = 0
  const idat: Buffer[] = []
  for (let off = 8; off + 8 <= buf.length;) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const bpp = CHANNELS[colorType]
  if (!bpp || depth !== 8 || interlace !== 0 || !width || !height) return false
  let raw: Buffer
  try { raw = inflateSync(Buffer.concat(idat)) } catch { return false }
  const stride = width * bpp
  if (raw.length < height * (stride + 1)) return false
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride)
  const first = new Uint8Array(bpp)
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1), filter = raw[row]
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0
      const v = raw[row + 1 + x]
      if (filter === 0) cur[x] = v
      else if (filter === 1) cur[x] = v + a
      else if (filter === 2) cur[x] = v + b
      else if (filter === 3) cur[x] = v + ((a + b) >> 1)
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        cur[x] = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      } else return false
    }
    if (y === 0) first.set(cur.subarray(0, bpp))
    for (let x = 0; x < stride; x++) if (cur[x] !== first[x % bpp]) return false
    ;[prev, cur] = [cur, prev]
  }
  return true
}
