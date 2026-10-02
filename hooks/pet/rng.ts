// Deterministic randomness. The pet's life is simulated minute by minute in every session that
// loads the mod; seeding each roll by the pet's id, the minute and what the roll is for makes them
// all reach the same pet, whichever session simulates it first.

/** FNV-1a over the string: a 32-bit seed. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** One number in [0, 1) for this seed: mulberry32's first draw. */
export function unit(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** A roll in [0, 1) named by its parts: `roll(pet.id, minute, 'bug')`. */
export const roll = (...parts: readonly (string | number)[]): number => unit(hash(parts.join(':')))

/** One item of `list`, picked by the roll. */
export const pick = <T>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))]!

/** A fresh id: random where the environment offers it. */
export function newId(now: number): string {
  const bytes = new Uint8Array(6)
  try {
    crypto.getRandomValues(bytes)
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(unit(hash(`${now}:${i}`)) * 256)
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
