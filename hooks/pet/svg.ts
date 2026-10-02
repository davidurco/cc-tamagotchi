import type { ShellColor } from '../../types'
import { blank, draw, spriteWidth } from './bitmap.ts'
import { ART, REACTION_MS, scene, WALK_LOOP, type ArtName, type Draw, type SceneInput } from './scene.ts'

// The pet for surfaces that draw SVG (the desktop app, the mobile app, the editor): a whole
// animation in one document. Each picture is defined once and placed by <use>; the frames are
// groups shown in turn by SMIL, so the drawing moves without the hooks module redrawing it.

export const LCD = { bg: '#b8c4a0', ink: '#2d3226', ghost: '#a7b38f', dark: '#3a4032', glow: '#c9d6ad' } as const

export const SHELLS: Record<ShellColor, { base: string; dark: string; light: string }> = {
  coral: { base: '#e8846b', dark: '#b4553f', light: '#f6b9a6' },
  mint: { base: '#76c9a6', dark: '#3f8f6d', light: '#c3eedb' },
  grape: { base: '#a58ad8', dark: '#6c55a3', light: '#d9cdf3' },
  sky: { base: '#77b4ef', dark: '#457fba', light: '#c7e2fb' },
  banana: { base: '#f0cd62', dark: '#b9922c', light: '#fbecb6' },
  ink: { base: '#474c59', dark: '#24272e', light: '#7b8191' },
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

/** One path for a picture: a 1×1 rectangle per run of lit pixels in a row. */
function pathOf(art: ArtName, variant: Pick<Draw, 'flip' | 'eyesClosed' | 'mouthOpen'>): string {
  const s = ART[art]!
  const w = spriteWidth(s)
  const b = blank(w, s.length)
  draw(b, s, 0, 0, variant)
  let d = ''
  for (let y = 0; y < b.h; y++) {
    let x = 0
    while (x < w) {
      if (!b.px[y * w + x]) {
        x++
        continue
      }
      let n = 1
      while (x + n < w && b.px[y * w + x + n]) n++
      d += `M${x} ${y}h${n}v1h-${n}z`
      x += n
    }
  }
  return d
}

type Clip = { frames: { draws: Draw[]; dark: boolean; ms: number }[]; loop: boolean }

/**
 * Samples the scene into frames: the reaction once if one is playing (`rt` ms into it), else the
 * walk's whole loop. Equal neighbours merge into one longer frame.
 */
export function clip(input: SceneInput, rt: number | null, w: number, h: number, every = 130): Clip {
  const playing = input.reaction && rt !== null && rt < REACTION_MS[input.reaction.kind]
  const from = playing ? rt! : 0
  const until = playing ? REACTION_MS[input.reaction!.kind] : WALK_LOOP
  const frames: Clip['frames'] = []
  let last = ''
  for (let t = from; t < until; t += every) {
    const f = scene(input, playing ? t : t, playing ? t : null, w, h)
    const k = JSON.stringify(f)
    if (k === last) frames[frames.length - 1]!.ms += every
    else frames.push({ ...f, ms: every })
    last = k
  }
  return { frames, loop: !playing }
}

/**
 * The frames as SVG: <defs> holding each picture once, then one group per frame. `scale` is the
 * size of a pixel, (ox, oy) where the screen's corner sits, `ink` the lit color.
 */
function animate(c: Clip, ox: number, oy: number, scale: number, w: number, h: number, ink: string, dark: { bg: string; ink: string } | null, idPrefix: string): string {
  const ids = new Map<string, string>()
  let defs = ''
  const ref = (d: Draw) => {
    const variant = { flip: d.flip, eyesClosed: d.eyesClosed, mouthOpen: d.mouthOpen }
    const key = `${d.art}|${d.flip ? 1 : 0}${d.eyesClosed ? 1 : 0}${d.mouthOpen ? 1 : 0}`
    let id = ids.get(key)
    if (!id) {
      id = `${idPrefix}${ids.size}`
      ids.set(key, id)
      defs += `<path id="${id}" d="${pathOf(d.art, variant)}"/>`
    }
    return id
  }
  const total = c.frames.reduce((n, f) => n + f.ms, 0)
  const dur = `${(total / 1000).toFixed(2)}s`
  let at = 0
  let body = ''
  c.frames.forEach((f, i) => {
    const uses = f.draws.map(d => `<use href="#${ref(d)}" x="${d.x}" y="${d.y}"/>`).join('')
    const fill = f.dark && dark ? dark.ink : ink
    const bg = f.dark && dark ? `<rect width="${w}" height="${h}" fill="${dark.bg}"/>` : ''
    const a = at / total
    const b = (at + f.ms) / total
    at += f.ms
    let anim = ''
    if (c.frames.length > 1) {
      // shown from a to b of each cycle; a clip that plays once holds its last frame
      const isLast = i === c.frames.length - 1
      const repeat = c.loop ? ' repeatCount="indefinite"' : ' fill="freeze"'
      const values = i === 0 ? '1;0' : isLast && !c.loop ? '0;1' : '0;1;0'
      const times = i === 0 ? `0;${b.toFixed(4)}` : isLast && !c.loop ? `0;${a.toFixed(4)}` : `0;${a.toFixed(4)};${b.toFixed(4)}`
      anim = `<animate attributeName="opacity" values="${values}" keyTimes="${times}" dur="${dur}" calcMode="discrete"${repeat}/>`
    }
    body += `<g fill="${fill}"${i === 0 || c.frames.length === 1 ? '' : ' opacity="0"'}>${anim}${bg}${uses}</g>`
  })
  return `<defs>${defs}</defs><g transform="translate(${ox} ${oy}) scale(${scale})">${body}</g>`
}

export type DeviceView = {
  input: SceneInput
  rt: number | null
  name: string
  shell: ShellColor
  /** Makes the document's ids its own, for a page that inlines several. */
  uid?: string
  /** One still frame at this moment instead of the animation (the README's pictures). */
  at?: { t: number; rt: number | null }
  /** Which of the eight icons around the screen are lit. */
  icons: { food: boolean; light: boolean; game: boolean; medicine: boolean; bath: boolean; meter: boolean; discipline: boolean; attention: boolean }
}

// the eight icons around the screen, 7×7 each
const ICONS: Record<keyof DeviceView['icons'], string[]> = {
  food: ['..###..', '.#####.', '##...##', '#.....#', '#.###.#', '#.###.#', '.#####.'],
  light: ['..###..', '.#...#.', '#.....#', '#.....#', '.#...#.', '..###..', '..###..'],
  game: ['..###..', '.#.#.#.', '#..#..#', '#######', '#..#..#', '.#.#.#.', '..###..'],
  medicine: ['...#...', '..###..', '...#...', '.#####.', '.#...#.', '.#...#.', '.#####.'],
  bath: ['.......', '.#..#..', '#.##.##', '.......', '.#..#..', '#.##.##', '.......'],
  meter: ['......#', '.....##', '....###', '...####', '..#####', '.######', '#######'],
  discipline: ['..###..', '..###..', '..###..', '..###..', '.......', '..###..', '..###..'],
  attention: ['.#####.', '#.....#', '#.#.#.#', '#.....#', '#.###.#', '#.....#', '.#####.'],
}

function icon(name: keyof DeviceView['icons'], x: number, y: number, on: boolean, blinks: boolean): string {
  let d = ''
  ICONS[name].forEach((row, iy) => {
    for (let ix = 0; ix < row.length; ix++) if (row[ix] === '#') d += `M${ix} ${iy}h1v1h-1z`
  })
  const anim = on && blinks ? `<animate attributeName="opacity" values="1;0.15;1" keyTimes="0;0.5;1" dur="1s" calcMode="discrete" repeatCount="indefinite"/>` : ''
  return `<path transform="translate(${x} ${y}) scale(1.4)" d="${d}" fill="${on ? LCD.ink : LCD.ghost}">${anim}</path>`
}

/** The whole device: an egg-shaped shell, the screen with its icons, three buttons, the name. */
export function deviceSvg(v: DeviceView): string {
  const c = SHELLS[v.shell] ?? SHELLS.coral
  const u = v.uid ?? 't'
  const W = 220
  const H = 250
  const px = 4
  const sx = 46
  const sy = 84
  const frames: Clip = v.at ? { frames: [{ ...scene(v.input, v.at.t, v.at.rt, 32, 16), ms: 1 }], loop: false } : clip(v.input, v.rt, 32, 16)
  const screen = animate(frames, sx, sy, px, 32, 16, LCD.ink, { bg: LCD.dark, ink: LCD.glow }, `${u}p`)
  const top = (['food', 'light', 'game', 'medicine'] as const).map((n, i) => icon(n, 52 + i * 32, 68, v.icons[n], false)).join('')
  const bottom = (['bath', 'meter', 'discipline', 'attention'] as const).map((n, i) => icon(n, 52 + i * 32, 155, v.icons[n], n === 'attention')).join('')
  const name = esc(v.name.toUpperCase().slice(0, 12))
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<defs><radialGradient id="${u}shell" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="${c.light}"/><stop offset="0.55" stop-color="${c.base}"/><stop offset="1" stop-color="${c.dark}"/></radialGradient>`,
    `<linearGradient id="${u}lcd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3cfab"/><stop offset="1" stop-color="${LCD.bg}"/></linearGradient></defs>`,
    // the key ring and the shell
    `<circle cx="110" cy="11" r="8" fill="none" stroke="${c.dark}" stroke-width="3"/>`,
    `<path d="M110 16 C176 16 210 92 210 152 C210 214 168 246 110 246 C52 246 10 214 10 152 C10 92 44 16 110 16 Z" fill="url(#${u}shell)" stroke="${c.dark}" stroke-width="2"/>`,
    `<path d="M70 40 C84 30 100 27 112 27" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="5" stroke-linecap="round"/>`,
    `<text x="110" y="53" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="10" font-weight="700" letter-spacing="3" fill="${c.dark}">${name}</text>`,
    // the screen's bezel and glass
    `<rect x="36" y="60" width="148" height="112" rx="14" fill="${c.dark}"/>`,
    `<rect x="40" y="64" width="140" height="104" rx="10" fill="url(#${u}lcd)"/>`,
    top,
    bottom,
    `<g>${screen}</g>`,
    // the three buttons
    ...[
      [76, 200, 'A'],
      [110, 212, 'B'],
      [144, 200, 'C'],
    ].map(([x, y, l]) => `<circle cx="${x}" cy="${y}" r="10" fill="${c.dark}"/><circle cx="${x}" cy="${(y as number) - 1.5}" r="8.5" fill="${c.light}"/><text x="${x}" y="${(y as number) + 18}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="7" fill="${c.dark}">${l}</text>`),
    `</svg>`,
  ].join('')
}

/** The pet strolling along a strip: the band above the prompt, where SVG is drawn. */
export function laneSvg(input: SceneInput, rt: number | null, color: string, columns = 96, uid = 'l'): string {
  const px = 3
  const w = columns
  const h = 16
  const body = animate(clip(input, rt, w, h), 0, 0, px, w, h, color, { bg: color, ink: '#ffffff' }, uid)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * px} ${h * px}" width="${w * px}" height="${h * px}">${body}</svg>`
}
