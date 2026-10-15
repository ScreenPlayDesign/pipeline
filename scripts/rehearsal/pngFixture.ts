// scripts/rehearsal/pngFixture.ts — tiny PNGs for the tests (png, post).
import { deflateSync } from 'node:zlib'

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)])   // CRC is not checked
}
/** An RGB PNG from rows of [r,g,b] pixels, every row written with `filter`. */
export function png(rows: number[][][], filter = 0): Buffer {
  const w = rows[0].length, h = rows.length
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw: number[] = []
  rows.forEach(row => {
    raw.push(filter)
    const flat = row.flat()
    flat.forEach((v, i) => raw.push(filter === 1 ? (v - (i >= 3 ? flat[i - 3] : 0)) & 0xff : v))
  })
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))])
}
