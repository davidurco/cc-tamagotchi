import type { Sprite } from './sprites.ts'

// A 1-bit picture: `w` by `h` pixels, one byte each (1 on, 0 off), row-major.
// Everything the LCD shows is composed into one of these, then painted for the surface at hand.

export type Bitmap = { w: number; h: number; px: Uint8Array }

export type Face = { eyesClosed?: boolean; mouthOpen?: boolean }

export const blank = (w: number, h: number): Bitmap => ({ w, h, px: new Uint8Array(w * h) })

export const get = (b: Bitmap, x: number, y: number): number =>
  x < 0 || y < 0 || x >= b.w || y >= b.h ? 0 : b.px[y * b.w + x]!

export const set = (b: Bitmap, x: number, y: number, on = 1): void => {
  if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.px[y * b.w + x] = on
}

export const spriteWidth = (s: Sprite): number => s.reduce((w, row) => Math.max(w, row.length), 0)

// whether the sprite's pixel at (x, y) is lit for this face
function lit(s: Sprite, x: number, y: number, face: Face): boolean {
  const c = s[y]?.[x]
  if (c === '#') return true
  if (c === 'M') return face.mouthOpen === true
  if (c === 'E') return !face.eyesClosed || s[y + 1]?.[x] !== 'E'
  return false
}

/**
 * Draws `s` with its top-left corner at (x, y); `flip` mirrors it (a creature walking left),
 * `invert` draws its lit pixels dark-on-light as off (used to cut a sprite out of a lit area).
 */
export function draw(b: Bitmap, s: Sprite, x: number, y: number, opts: Face & { flip?: boolean; erase?: boolean } = {}): void {
  const w = spriteWidth(s)
  for (let sy = 0; sy < s.length; sy++) {
    for (let sx = 0; sx < w; sx++) {
      if (!lit(s, sx, sy, opts)) continue
      set(b, x + (opts.flip ? w - 1 - sx : sx), y + sy, opts.erase ? 0 : 1)
    }
  }
}

/** Every lit pixel becomes off and every off one lit: the screen with the lights out. */
export function invert(b: Bitmap): Bitmap {
  const px = new Uint8Array(b.px.length)
  for (let i = 0; i < px.length; i++) px[i] = b.px[i] ? 0 : 1
  return { w: b.w, h: b.h, px }
}

/** A cheap fingerprint, so a surface redraws only when a frame actually changed. */
export function key(b: Bitmap): string {
  let out = ''
  for (let i = 0; i < b.px.length; i += 6) {
    let n = 0
    for (let j = 0; j < 6 && i + j < b.px.length; j++) n = (n << 1) | b.px[i + j]!
    out += String.fromCharCode(48 + n)
  }
  return out
}
