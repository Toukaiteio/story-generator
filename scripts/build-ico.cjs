const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const zlib = require('node:zlib')

const root = join(__dirname, '..')
const png = readFileSync(join(root, 'build', 'icon.png'))

const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)

const idatChunks = []
let offset = 8
while (offset < png.length) {
  const length = png.readUInt32BE(offset)
  const type = png.toString('ascii', offset + 4, offset + 8)
  if (type === 'IDAT') idatChunks.push(png.subarray(offset + 8, offset + 8 + length))
  offset += length + 12
}

const raw = zlib.inflateSync(Buffer.concat(idatChunks))
const bpp = 4
const stride = width * bpp
const pixels = Buffer.alloc(width * height * bpp)

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)]
  const rowStart = y * stride
  const prevStart = (y - 1) * stride
  for (let x = 0; x < stride; x++) {
    const value = raw[y * (stride + 1) + 1 + x]
    const left = x >= bpp ? pixels[rowStart + x - bpp] : 0
    const up = y > 0 ? pixels[prevStart + x] : 0
    const upLeft = y > 0 && x >= bpp ? pixels[prevStart + x - bpp] : 0
    let decoded
    if (filter === 0) decoded = value
    else if (filter === 1) decoded = value + left
    else if (filter === 2) decoded = value + up
    else if (filter === 3) decoded = value + Math.floor((left + up) / 2)
    else if (filter === 4) decoded = value + paeth(left, up, upLeft)
    else throw new Error(`Unsupported PNG filter ${filter}`)
    pixels[rowStart + x] = decoded & 0xff
  }
}

const target = 256
const scaled = Buffer.alloc(target * target * 4)
for (let y = 0; y < target; y++) {
  const sy = Math.min(height - 1, Math.floor((y * height) / target))
  for (let x = 0; x < target; x++) {
    const sx = Math.min(width - 1, Math.floor((x * width) / target))
    pixels.copy(scaled, (y * target + x) * 4, (sy * width + sx) * 4, (sy * width + sx) * 4 + 4)
  }
}

const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
const crc32 = buffer => {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const rows = Buffer.alloc((target * 4 + 1) * target)
for (let y = 0; y < target; y++) {
  rows[y * (target * 4 + 1)] = 0
  scaled.copy(rows, y * (target * 4 + 1) + 1, y * target * 4, (y + 1) * target * 4)
}

const header = Buffer.alloc(13)
header.writeUInt32BE(target, 0)
header.writeUInt32BE(target, 4)
header[8] = 8
header[9] = 6

const smallPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)

const entry = Buffer.alloc(16)
entry[0] = 0
entry[1] = 0
entry[2] = 0
entry[3] = 0
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(smallPng.length, 8)
entry.writeUInt32LE(22, 12)

writeFileSync(join(root, 'build', 'icon.ico'), Buffer.concat([icoHeader, entry, smallPng]))
console.log(`icon.ico written (${smallPng.length + 22} bytes)`)
