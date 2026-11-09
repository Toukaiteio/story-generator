const { execFileSync } = require('node:child_process')
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const zlib = require('node:zlib')

const root = join(__dirname, '..')
const svgPath = join(root, 'build', 'icon.svg')
const pngPath = join(root, 'build', 'icon.png')

function renderWithChromium() {
  const candidates = [
    process.env.CHROMIUM_BIN,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean)

  const browser = candidates.find(candidate => existsSync(candidate))
  if (!browser) return false

  const profile = mkdtempSync(join(tmpdir(), 'story-icon-'))

  try {
    execFileSync(browser, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      '--default-background-color=00000000',
      '--window-size=512,512',
      `--screenshot=${pngPath}`,
      `file://${svgPath}`,
    ], { stdio: 'ignore', env: { ...process.env, HOME: tmpdir() } })
  } catch {
    return existsSync(pngPath) && readFileSync(pngPath).length > 4000
  }

  return existsSync(pngPath) && readFileSync(pngPath).length > 4000
}

function renderFallback() {
  const size = 512
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

  const px = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    const alpha = a / 255
    px[i] = Math.round(r * alpha + px[i] * (1 - alpha))
    px[i + 1] = Math.round(g * alpha + px[i + 1] * (1 - alpha))
    px[i + 2] = Math.round(b * alpha + px[i + 2] * (1 - alpha))
    px[i + 3] = Math.max(px[i + 3], a)
  }
  const insideRoundRect = (x, y, left, top, right, bottom, radius) => {
    if (x < left || x > right || y < top || y > bottom) return false
    const cx = Math.min(Math.max(x, left + radius), right - radius)
    const cy = Math.min(Math.max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
  }
  const line = (x1, y1, x2, y2, width, color) => {
    const minX = Math.floor(Math.min(x1, x2) - width)
    const maxX = Math.ceil(Math.max(x1, x2) + width)
    const minY = Math.floor(Math.min(y1, y2) - width)
    const maxY = Math.ceil(Math.max(y1, y2) + width)
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const vx = x2 - x1
        const vy = y2 - y1
        const lengthSq = vx * vx + vy * vy || 1
        const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / lengthSq))
        const dx = x - (x1 + t * vx)
        const dy = y - (y1 + t * vy)
        if (dx * dx + dy * dy <= (width / 2) ** 2) set(x, y, color)
      }
    }
  }
  const circle = (cx, cy, radius, color) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) set(x, y, color)
      }
    }
  }

  const blue = [0, 122, 255, 255]
  const white = [255, 255, 255, 255]
  const soft = [234, 244, 255, 255]

  for (let y = 0; y < size; y++) {
    const t = y / size
    const color = [Math.round(255 + (234 - 255) * t), Math.round(255 + (244 - 255) * t), 255, 255]
    for (let x = 0; x < size; x++) {
      if (insideRoundRect(x, y, 0, 0, size - 1, size - 1, 112)) set(x, y, color)
    }
  }

  line(256, 158, 256, 374, 24, blue)
  for (const direction of [-1, 1]) {
    const points = []
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      points.push({
        x: 256 + direction * Math.sin(t * Math.PI) * 118,
        y: 158 + t * 216,
      })
    }
    for (let i = 0; i < points.length - 1; i++) {
      line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, 24, blue)
    }
  }

  circle(352, 348, 84, white)
  circle(352, 348, 74, soft)
  line(330, 364, 378, 316, 20, blue)
  line(378, 316, 392, 330, 18, blue)
  line(324, 380, 332, 356, 16, blue)

  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  writeFileSync(pngPath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

if (!renderWithChromium()) renderFallback()
console.log(`icon.png written (${readFileSync(pngPath).length} bytes)`)
