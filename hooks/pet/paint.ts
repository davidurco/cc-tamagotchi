import { get, type Bitmap } from './bitmap.ts'

// Turning a bitmap into terminal characters. Two pixels per cell, one above the other, with the
// half blocks (crisp, square pixels: the device's LCD), or eight per cell with braille dots (a
// dot-matrix look a quarter the height: the band above the prompt).

const HALF = [' ', '▄', '▀', '█'] as const

/** One string per row of cells, h/2 rows: top pixel ▀, bottom ▄, both █. */
export function halfBlocks(b: Bitmap): string[] {
  const rows: string[] = []
  for (let y = 0; y < b.h; y += 2) {
    let row = ''
    for (let x = 0; x < b.w; x++) row += HALF[(get(b, x, y) << 1) | get(b, x, y + 1)]
    rows.push(row)
  }
  return rows
}

/** Doubled: each pixel two cells wide and one tall, so a 32×16 screen fills 64×16 cells. */
export function bigBlocks(b: Bitmap): string[] {
  const rows: string[] = []
  for (let y = 0; y < b.h; y++) {
    let row = ''
    for (let x = 0; x < b.w; x++) row += get(b, x, y) ? '██' : '  '
    rows.push(row)
  }
  return rows
}

// the braille dot for each pixel of a 2×4 cell, as Unicode numbers them
const DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const

/** One string per row of cells, h/4 rows, each cell a braille character (blank cells a space). */
export function braille(b: Bitmap): string[] {
  const rows: string[] = []
  for (let y = 0; y < b.h; y += 4) {
    let row = ''
    for (let x = 0; x < b.w; x += 2) {
      let bits = 0
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) if (get(b, x + dx, y + dy)) bits |= DOT[dy]![dx]!
      row += bits ? String.fromCharCode(0x2800 + bits) : ' '
    }
    rows.push(row)
  }
  return rows
}
