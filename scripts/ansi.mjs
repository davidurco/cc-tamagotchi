// Turns a terminal capture (`tmux capture-pane -e -p`) into an SVG: every cell its background,
// block and braille characters drawn as shapes so pixel art stays crisp, other text as text.
// Used to make the README's pictures from a real Claude Code session; not part of the mod.

const PALETTE16 = ['#1e1e1e', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d0d0d0', '#5c6370', '#ff7b86', '#b5e890', '#ffd479', '#7cc4ff', '#de9bff', '#7fe0ea', '#ffffff']

function xterm256(n) {
  if (n < 16) return PALETTE16[n]
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return `rgb(${v},${v},${v})`
  }
  const i = n - 16
  const c = [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map(v => (v ? 55 + v * 40 : 0))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

const isWide = cp => (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0x1f300 && cp <= 0x1faff)

/** Parses the capture into rows of cells: { ch, fg, bg, bold, dim, italic, inverse }. */
export function parse(text, columns) {
  const rows = []
  let style = {}
  for (const line of text.split('\n')) {
    const row = []
    let i = 0
    while (i < line.length) {
      if (line[i] === '\x1b' && line[i + 1] === ']') {
        // an OSC (a hyperlink): skip to its terminator
        const bel = line.indexOf('\x07', i)
        const st = line.indexOf('\x1b\\', i)
        const ends = [bel, st].filter(n => n >= 0)
        i = ends.length ? Math.min(...ends) + (Math.min(...ends) === st ? 2 : 1) : line.length
        continue
      }
      if (line[i] === '\x1b' && line[i + 1] === '[') {
        let end = i + 2
        while (end < line.length && !/[@-~]/.test(line[end])) end++
        if (line[end] !== 'm') {
          i = end + 1
          continue
        }
        const params = line.slice(i + 2, end).split(';').map(Number)
        for (let k = 0; k < params.length; k++) {
          const p = params[k] || 0
          if (p === 0) style = {}
          else if (p === 1) style = { ...style, bold: true }
          else if (p === 2) style = { ...style, dim: true }
          else if (p === 3) style = { ...style, italic: true }
          else if (p === 7) style = { ...style, inverse: true }
          else if (p === 22) style = { ...style, bold: false, dim: false }
          else if (p === 23) style = { ...style, italic: false }
          else if (p === 27) style = { ...style, inverse: false }
          else if (p >= 30 && p <= 37) style = { ...style, fg: PALETTE16[p - 30] }
          else if (p >= 90 && p <= 97) style = { ...style, fg: PALETTE16[p - 82] }
          else if (p >= 40 && p <= 47) style = { ...style, bg: PALETTE16[p - 40] }
          else if (p >= 100 && p <= 107) style = { ...style, bg: PALETTE16[p - 92] }
          else if (p === 39) style = { ...style, fg: undefined }
          else if (p === 49) style = { ...style, bg: undefined }
          else if (p === 38 || p === 48) {
            const key = p === 38 ? 'fg' : 'bg'
            if (params[k + 1] === 5) {
              style = { ...style, [key]: xterm256(params[k + 2]) }
              k += 2
            } else if (params[k + 1] === 2) {
              style = { ...style, [key]: `rgb(${params[k + 2]},${params[k + 3]},${params[k + 4]})` }
              k += 4
            }
          }
        }
        i = end + 1
        continue
      }
      const cp = line.codePointAt(i)
      const ch = String.fromCodePoint(cp)
      if (cp < 32 || cp === 0x7f) {
        i += 1
        continue
      }
      row.push({ ch, ...style })
      if (isWide(cp)) row.push({ ch: '', ...style })
      i += ch.length
    }
    while (row.length < columns) row.push({ ch: ' ', ...style, fg: undefined, bold: false })
    rows.push(row.slice(0, columns))
  }
  return rows
}

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
// glyphs the bundled font lacks, drawn as their nearest look-alike
const FALLBACK = { '⏵': '▸', '⏸': '‖', '⎿': '└', '✻': '✱', '✽': '✱', '✶': '✱', '✳': '✱', '✢': '✱' }

/** Draws parsed rows as SVG markup at cell size cw×ch; returns the inner markup and its size. */
export function draw(rows, { cw = 9, chh = 19, fg: defFg = '#d7d7d7', bg: defBg = '#16171b', font = 'DejaVu Sans Mono, monospace', fontSize = 15 } = {}) {
  let out = ''
  const W = (rows[0]?.length ?? 0) * cw
  const H = rows.length * chh
  out += `<rect width="${W}" height="${H}" fill="${defBg}"/>`
  rows.forEach((row, y) => {
    row.forEach((c, x) => {
      let fg = c.fg ?? defFg
      let bg = c.bg
      if (c.inverse) [fg, bg] = [bg ?? defBg, fg]
      const X = x * cw
      const Y = y * chh
      if (bg) out += `<rect x="${X}" y="${Y}" width="${cw + 0.5}" height="${chh + 0.5}" fill="${bg}"/>`
      const cp = c.ch.codePointAt(0) ?? 32
      const op = c.dim ? ' opacity="0.55"' : ''
      if (c.ch === ' ' || c.ch === '') return
      if (cp === 0x2580) out += `<rect x="${X}" y="${Y}" width="${cw + 0.5}" height="${chh / 2 + 0.3}" fill="${fg}"${op}/>`
      else if (cp === 0x2584) out += `<rect x="${X}" y="${Y + chh / 2}" width="${cw + 0.5}" height="${chh / 2 + 0.5}" fill="${fg}"${op}/>`
      else if (cp === 0x2588) out += `<rect x="${X}" y="${Y}" width="${cw + 0.5}" height="${chh + 0.5}" fill="${fg}"${op}/>`
      else if (cp >= 0x2800 && cp <= 0x28ff) {
        const bits = cp - 0x2800
        const dots = [[0, 0, 0x01], [0, 1, 0x02], [0, 2, 0x04], [1, 0, 0x08], [1, 1, 0x10], [1, 2, 0x20], [0, 3, 0x40], [1, 3, 0x80]]
        for (const [dx, dy, bit] of dots) if (bits & bit) out += `<circle cx="${X + cw * (0.28 + dx * 0.44)}" cy="${Y + chh * (0.14 + dy * 0.24)}" r="${cw * 0.17}" fill="${fg}"${op}/>`
      } else if (cp >= 0x2500 && cp <= 0x257f) {
        out += boxChar(cp, X, Y, cw, chh, fg, op)
      } else {
        const weight = c.bold ? ' font-weight="700"' : ''
        const style = c.italic ? ' font-style="italic"' : ''
        out += `<text x="${X}" y="${Y + chh * 0.76}" font-family="${font}" font-size="${fontSize}" fill="${fg}"${weight}${style}${op}>${esc(FALLBACK[c.ch] ?? c.ch)}</text>`
      }
    })
  })
  return { markup: out, width: W, height: H }
}

// box drawing as lines, so frames join up whatever the font
function boxChar(cp, X, Y, cw, ch, fg, op) {
  const mx = X + cw / 2
  const my = Y + ch / 2
  const L = `M${X} ${my}H${mx}`
  const R = `M${mx} ${my}H${X + cw}`
  const U = `M${mx} ${Y}V${my}`
  const D = `M${mx} ${my}V${Y + ch}`
  const arc = (a, b) => `M${a[0]} ${a[1]}Q${mx} ${my} ${b[0]} ${b[1]}`
  const map = {
    0x2500: L + R, 0x2502: U + D, 0x250c: R + D, 0x2510: L + D, 0x2514: R + U, 0x2518: L + U, 0x251c: U + D + R, 0x2524: U + D + L, 0x252c: L + R + D, 0x2534: L + R + U, 0x253c: L + R + U + D,
    0x256d: arc([mx, Y + ch], [X + cw, my]), 0x256e: arc([X, my], [mx, Y + ch]), 0x256f: arc([mx, Y], [X, my]), 0x2570: arc([mx, Y], [X + cw, my]),
    0x2550: `M${X} ${my - 2}H${X + cw}M${X} ${my + 2}H${X + cw}`, 0x2551: `M${mx - 2} ${Y}V${Y + ch}M${mx + 2} ${Y}V${Y + ch}`,
    0x254c: L + R, 0x2504: L + R,
  }
  const d = map[cp]
  if (!d) return `<text x="${X}" y="${Y + ch * 0.76}" font-family="monospace" font-size="15" fill="${fg}"${op}>${String.fromCodePoint(cp)}</text>`
  return `<path d="${d}" stroke="${fg}" stroke-width="1.3" fill="none"${op}/>`
}

/** A whole capture as an SVG document, in a window frame. */
export function svgOf(text, { columns, title = 'claude', pad = 18 } = {}) {
  const rows = parse(text.replace(/\n$/, ''), columns)
  const { markup, width, height } = draw(rows)
  const W = width + pad * 2
  const H = height + pad * 2 + 30
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" rx="12" fill="#16171b"/>
<rect width="${W}" height="30" rx="12" fill="#26282e"/><rect y="18" width="${W}" height="12" fill="#26282e"/>
<circle cx="20" cy="15" r="6" fill="#ff5f57"/><circle cx="40" cy="15" r="6" fill="#febc2e"/><circle cx="60" cy="15" r="6" fill="#28c840"/>
<text x="${W / 2}" y="20" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="13" fill="#9aa0a6">${esc(title)}</text>
<g transform="translate(${pad} ${30 + pad})">${markup}</g></svg>`
}
