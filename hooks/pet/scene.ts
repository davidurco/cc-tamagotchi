import type { ReactionKind, SpeciesId } from '../../types'
import { blank, draw, invert, spriteWidth, type Bitmap } from './bitmap.ts'
import { roll } from './rng.ts'
import * as S from './sprites.ts'
import type { Sprite } from './sprites.ts'
import { SPECIES } from './species.ts'

// What the LCD shows at a moment: the pet walking about, its bugs, the icons around it, and the
// animation of whatever just happened. `scene` is a pure function of what the hooks module knows
// (SceneInput) and the screen's clock, and returns a display list: the terminal rasterizes it into
// a Bitmap, the desktop turns a run of them into an animated SVG.

/** Every picture a scene can place, by name: the SVG defines each once and reuses it. */
export const ART: Record<string, Sprite> = {
  ...Object.fromEntries(Object.values(SPECIES).map(s => [s.id, s.sprite])),
  angel: S.ANGEL,
  crack: S.CRACK,
  bug0: S.BUG[0]!,
  bug1: S.BUG[1]!,
  rice0: S.RICE[0]!,
  rice1: S.RICE[1]!,
  rice2: S.RICE[2]!,
  candy0: S.CANDY[0]!,
  candy1: S.CANDY[1]!,
  candy2: S.CANDY[2]!,
  pill: S.PILL,
  heart: S.SMALL_HEART,
  note: S.NOTE,
  skull: S.SKULL,
  bang: S.BANG,
  sweat: S.SWEAT,
  zz: S.ZZ,
  z: S.SMALL_Z,
  spark0: S.SPARK[0]!,
  spark1: S.SPARK[1]!,
  left: S.ARROW_LEFT,
  right: S.ARROW_RIGHT,
  check: S.CHECK,
  cross: S.CROSS,
  star: S.STAR,
  wave: S.WAVE,
}

export type ArtName = keyof typeof ART & string

export type Draw = { art: ArtName; x: number; y: number; flip?: boolean; eyesClosed?: boolean; mouthOpen?: boolean }
export type Frame = { draws: Draw[]; dark: boolean }

/** Everything about the pet a screen needs, as plain data: what the hooks module hands a Client. */
export type SceneInput = {
  species: SpeciesId
  seed: string
  asleep: boolean
  tucked: boolean
  sick: boolean
  bugs: number
  calling: boolean
  tantrum: boolean
  sad: boolean
  working: boolean
  gone: boolean
  reaction: { kind: ReactionKind; id: number; from?: SpeciesId } | null
  game: { answer: 'left' | 'right' | null; guess: 'left' | 'right' | null; round: number } | null
}

/** How long each animation plays, in milliseconds. */
export const REACTION_MS: Record<ReactionKind, number> = {
  eat: 2400,
  snack: 2400,
  refuse: 1500,
  happy: 1400,
  pat: 1400,
  clean: 1800,
  medicine: 1600,
  scold: 1400,
  cheer: 1200,
  flinch: 900,
  party: 2000,
  nibble: 500,
  hatch: 2600,
  evolve: 3200,
  sleep: 1200,
  wake: 1000,
  win: 2000,
  lose: 1500,
}

const SEGMENT = 2400
const STEP = 130
/** The walk repeats after this many segments, so the desktop can loop it seamlessly. */
export const WALK_SEGMENTS = 4
export const WALK_LOOP = SEGMENT * WALK_SEGMENTS

const size = (art: ArtName) => {
  const s = ART[art]!
  return { w: spriteWidth(s), h: s.length }
}

/** Where a walking pet is at time t: it strolls to a new spot each segment, then waits. */
export function walk(seed: string, t: number, maxX: number): { x: number; flip: boolean; moving: boolean; hop: boolean } {
  if (maxX <= 0) return { x: 0, flip: false, moving: false, hop: false }
  const k = Math.floor(t / SEGMENT)
  const spot = (n: number) => Math.round(roll(seed, 'walk', ((n % WALK_SEGMENTS) + WALK_SEGMENTS) % WALK_SEGMENTS) * maxX)
  const from = spot(k)
  const to = spot(k + 1)
  const local = t - k * SEGMENT
  const dx = to - from
  const moved = Math.min(Math.abs(dx), Math.floor(local / STEP))
  const moving = moved < Math.abs(dx)
  return { x: from + Math.sign(dx) * moved, flip: dx < 0 || (dx === 0 && spot(k - 1) > from), moving, hop: moving && Math.floor(local / (STEP * 2)) % 2 === 1 }
}

/**
 * The display list at clock `t` (ms since the screen began) on a w×h screen. `rt` is how long the
 * current reaction has been playing, or null when none is.
 */
export function scene(input: SceneInput, t: number, rt: number | null, w = 32, h = 16): Frame {
  const draws: Draw[] = []
  const reaction = input.reaction && rt !== null && rt < REACTION_MS[input.reaction.kind] ? input.reaction.kind : null
  const r = rt ?? 0
  const blink = (period: number, on: number) => t % period < on

  if (input.gone) {
    const { w: sw, h: sh } = size('angel')
    const bob = Math.floor(t / 600) % 2
    draws.push({ art: 'angel', x: Math.floor((w - sw) / 2), y: h - sh - 1 - bob })
    return { draws, dark: false }
  }

  if (input.species === 'egg' || (reaction === 'hatch' && r < 2100)) {
    return egg(input, t, reaction === 'hatch' ? r : null, w, h)
  }

  // the pet's sprite this frame: during an evolution it flickers between the old form and the new
  let art: ArtName = input.species
  if (reaction === 'evolve' && input.reaction?.from && Math.floor(r / 250) % 2 === 0 && r < REACTION_MS.evolve - 600) art = input.reaction.from
  const { w: sw, h: sh } = size(art)

  // bugs stand at the right edge, in one column or two; the pet keeps out of their way
  const bugCols = input.bugs === 0 ? 0 : input.bugs <= 2 ? 1 : 2
  // the right edge also holds the corner icon (a spark while Claude works, a skull while sick)
  const corner = !input.asleep && (input.working || input.sick) ? 6 : 0
  const room = w - Math.max(bugCols * 6, corner)
  const maxX = Math.max(0, room - sw)
  const center = Math.floor(maxX / 2)

  // lights out: the screen goes dark and only the Z's show
  if (input.tucked && reaction !== 'wake') {
    const z = Math.floor(t / 700) % 2 === 0 ? 'zz' : 'z'
    const { w: zw } = size(z)
    draws.push({ art: z, x: Math.floor((w - zw) / 2) + (z === 'z' ? 3 : 0), y: Math.floor(h / 2) - 2 - (z === 'z' ? 2 : 0) })
    return { draws, dark: true }
  }

  let x = center
  let y = h - sh
  let flip = false
  let eyesClosed = false
  let mouthOpen = false
  const front: Draw[] = []

  const isStill = input.asleep || input.sick || input.game !== null || (reaction !== null && reaction !== 'nibble' && reaction !== 'cheer' && reaction !== 'flinch')
  if (!isStill) {
    const step = walk(input.seed, t, maxX)
    x = step.x
    flip = step.flip
    if (step.hop) y -= 1
  } else if (input.sick && !reaction) {
    // too sick to stroll: shuffles a little
    x = Math.max(0, Math.min(maxX, center + (Math.floor(t / 900) % 2)))
  }

  // a blink every few seconds
  if (blink(3700, 160)) eyesClosed = true

  if (input.asleep) {
    eyesClosed = true
    const z = Math.floor(t / 800) % 2 === 0 ? 'zz' : 'z'
    const zx = x + sw + 4 <= room ? x + sw : Math.max(0, x - 4)
    front.push({ art: z, x: zx, y: z === 'zz' ? 0 : 1 })
  }

  if (input.game) {
    // it stands in the middle; the way it looked, and whether the guess was right, at that side
    const g = input.game
    x = center
    if (g.answer) {
      flip = g.answer === 'left'
      const side = g.answer === 'left' ? 0 : room - 7
      front.push({ art: g.answer === 'left' ? 'left' : 'right', x: g.answer === 'left' ? 0 : room - 4, y: 1 })
      front.push({ art: g.guess === g.answer ? 'check' : 'cross', x: side, y: 9 })
    } else if (blink(800, 400)) {
      front.push({ art: 'left', x: 0, y: 4 }, { art: 'right', x: room - 4, y: 4 })
    }
  }

  switch (reaction) {
    case 'eat':
    case 'snack': {
      x = Math.min(maxX, 2)
      flip = false
      const bite = Math.floor(r / 600)
      mouthOpen = bite % 2 === 1
      const food = `${reaction === 'eat' ? 'rice' : 'candy'}${Math.min(2, Math.floor(r / 800))}` as ArtName
      front.push({ art: food, x: x + sw + 1, y: h - 8 })
      break
    }
    case 'refuse':
      flip = Math.floor(r / 250) % 2 === 1
      eyesClosed = true
      front.push({ art: 'cross', x: Math.min(w - 6, x + sw + 1), y: 2 })
      break
    case 'happy':
    case 'pat':
    case 'win': {
      eyesClosed = true
      y -= Math.floor(r / 200) % 2 === 1 ? 2 : 0
      const rise = Math.floor(r / 350)
      front.push({ art: 'heart', x: Math.min(w - 5, x + sw), y: Math.max(0, 5 - rise) })
      if (reaction === 'win') front.push({ art: 'heart', x: Math.max(0, x - 5), y: Math.max(0, 7 - rise) })
      break
    }
    case 'cheer': {
      y -= Math.floor(r / 200) % 2 === 1 ? 2 : 0
      mouthOpen = true
      front.push({ art: 'note', x: Math.min(w - 5, x + sw), y: Math.max(0, 4 - Math.floor(r / 300)) })
      break
    }
    case 'party': {
      y -= Math.floor(r / 250) % 2 === 1 ? 2 : 0
      mouthOpen = true
      // confetti around it, never over its face
      const burst = Math.floor(r / 250)
      const spots = [...Array(Math.max(0, x - 5)).keys(), ...Array.from({ length: Math.max(0, room - 5 - (x + sw)) }, (_, i) => x + sw + 1 + i)]
      for (let i = 0; i < 3 && spots.length; i++) {
        const sx = spots[Math.floor(roll(input.reaction!.id, burst, i, 'x') * spots.length)]!
        front.push({ art: 'star', x: sx, y: Math.floor(roll(input.reaction!.id, burst, i, 'y') * 11) })
      }
      break
    }
    case 'flinch':
      eyesClosed = r > 300
      if (r < 300) y -= 2
      front.push({ art: 'bang', x: Math.min(w - 2, x + sw + 1), y: 1 })
      break
    case 'nibble':
      mouthOpen = r < 250
      break
    case 'medicine':
      eyesClosed = r > 500
      front.push({ art: 'pill', x: Math.min(w - 8, x + sw + 1), y: r < 800 ? 6 : 8 })
      if (r > 1100) x = Math.max(0, x + (Math.floor(r / 100) % 2))
      break
    case 'scold':
      eyesClosed = true
      y += 1
      front.push({ art: 'bang', x: Math.min(w - 2, x + sw + 1), y: 0 })
      break
    case 'lose':
      eyesClosed = true
      front.push({ art: 'sweat', x: Math.max(0, x - 4), y: 3 })
      break
    case 'wake':
      y -= r < 300 ? 2 : 0
      front.push({ art: 'bang', x: Math.min(w - 2, x + sw + 1), y: 1 })
      break
    case 'sleep':
      eyesClosed = true
      break
    case 'hatch':
      y -= Math.floor(r / 150) % 2 === 1 ? 1 : 0
      break
    default:
      break
  }

  // the state around it, when no animation says otherwise
  if (!reaction && !input.asleep) {
    // the corner above the bugs: a skull while sick, else a spark while Claude works
    if (input.sick) {
      if (blink(1000, 600)) front.push({ art: 'skull', x: w - 6, y: 0 })
    } else if (input.working) front.push({ art: Math.floor(t / 350) % 2 ? 'spark1' : 'spark0', x: w - 5, y: 0 })
    if (input.tantrum) {
      x = Math.max(0, Math.min(maxX, x + (Math.floor(t / 150) % 2 ? 1 : -1)))
      if (blink(500, 300)) front.push({ art: 'bang', x: Math.min(room - 2, x + sw + 1), y: 1 })
    } else if (input.calling && blink(1000, 500)) {
      front.push({ art: 'bang', x: Math.min(room - 2, x + sw + 1), y: 1 })
    }
    if (input.sad && !input.calling) front.push({ art: 'sweat', x: Math.max(0, x - 4), y: 3 })
  }

  // bugs, wiggling; a clean washes them away right to left
  const wave = reaction === 'clean' ? w - Math.floor((r / REACTION_MS.clean) * (w + 6)) : null
  for (let i = 0; i < input.bugs; i++) {
    const bx = w - 5 - (i >= 2 ? 6 : 0)
    if (wave !== null && bx >= wave) continue
    draws.push({ art: (Math.floor(t / 400) + i) % 2 ? 'bug1' : 'bug0', x: bx, y: h - 5 - (i % 2) * 6 })
  }
  if (wave !== null) draws.push({ art: 'wave', x: wave, y: 0 })

  draws.push({ art, x, y, flip, eyesClosed, mouthOpen })
  draws.push(...front)
  return { draws, dark: false }
}

function egg(input: SceneInput, t: number, r: number | null, w: number, h: number): Frame {
  const { w: ew, h: eh } = size('egg')
  const x = Math.floor((w - ew) / 2)
  const draws: Draw[] = []
  if (r !== null) {
    // hatching: a fast wobble, the crack, a flash
    const tilt = r < 1200 ? (Math.floor(r / 120) % 2 ? 1 : -1) : 0
    draws.push({ art: 'egg', x: x + tilt, y: h - eh })
    if (r >= 900) draws.push({ art: 'crack', x: x + tilt, y: h - eh })
    return { draws, dark: r >= 1700 && Math.floor(r / 100) % 2 === 0 }
  }
  const period = input.working ? 900 : 2600
  const phase = t % period
  const tilt = phase < 240 ? -1 : phase < 480 ? 1 : 0
  draws.push({ art: 'egg', x: x + tilt, y: h - eh })
  return { draws, dark: false }
}

/** Rasterizes a frame onto a w×h bitmap. */
export function rasterize(frame: Frame, w = 32, h = 16): Bitmap {
  const b = blank(w, h)
  for (const d of frame.draws) {
    const s = ART[d.art]
    if (s) draw(b, s, d.x, d.y, { flip: d.flip, eyesClosed: d.eyesClosed, mouthOpen: d.mouthOpen })
  }
  return frame.dark ? invert(b) : b
}
