import type { SpeciesId, Stage } from '../../types'
import * as S from './sprites.ts'
import type { Sprite } from './sprites.ts'

// Who the pet can be. It hatches as a Bit, grows into a Nibble, then a teen picked by how well it
// was cared for, then one of eight adults picked by care and by the work it watched Claude do.

export type Species = {
  id: SpeciesId
  name: string
  stage: Stage
  sprite: Sprite
  /** One line about it, for the stats page and the README. */
  blurb: string
  /** How it is reached, for the evolution chart. */
  how: string
  /** Grams it weighs when it reaches this form. */
  weight: number
  /** Its face beside the spinner and in the one-line band: content, then sleepy. */
  face: string
}

export const SPECIES: Record<SpeciesId, Species> = {
  egg: { id: 'egg', name: 'Egg', stage: 'egg', sprite: S.EGG, blurb: 'Something is moving inside.', how: 'Where every pet starts.', weight: 5, face: '( )' },
  bit: { id: 'bit', name: 'Bit', stage: 'baby', sprite: S.BIT, blurb: 'The smallest unit of joy.', how: 'Hatches after a minute and a tool call.', weight: 5, face: '(•ω•)' },
  nibble: { id: 'nibble', name: 'Nibble', stage: 'child', sprite: S.NIBBLE, blurb: 'Four bits of mischief.', how: '1 hour old and 40 tool calls watched.', weight: 10, face: '(=^ω^=)' },
  bytey: { id: 'bytey', name: 'Bytey', stage: 'teen', sprite: S.BYTEY, blurb: 'A well-raised teenager. Eight bits, all in order.', how: '1 day old, 250 tool calls, few care mistakes.', weight: 18, face: 'ʕ•ω•ʔ' },
  glitchy: { id: 'glitchy', name: 'Glitchy', stage: 'teen', sprite: S.GLITCHY, blurb: 'Some of its bits got flipped along the way.', how: '1 day old, 250 tool calls, many care mistakes.', weight: 16, face: '(⊙_⊙)' },
  assertoise: { id: 'assertoise', name: 'Assertoise', stage: 'adult', sprite: S.ASSERTOISE, blurb: 'Slow, steady, and every test green. Carries the checkmark on its back.', how: 'Grows up watching Claude run tests.', weight: 30, face: '(✓_✓)' },
  refactopus: { id: 'refactopus', name: 'Refactopus', stage: 'adult', sprite: S.REFACTOPUS, blurb: 'Eight arms, eight files open, zero fear of a big diff.', how: 'Grows up watching Claude edit code.', weight: 26, face: '(◕ω◕)' },
  shellby: { id: 'shellby', name: 'Shellby', stage: 'adult', sprite: S.SHELLBY, blurb: 'Lives in the terminal. Pipes things into other things.', how: 'Grows up watching Claude run shell commands.', weight: 24, face: '(°▽°)' },
  grepossum: { id: 'grepossum', name: 'Grepossum', stage: 'adult', sprite: S.GREPOSSUM, blurb: 'Reads every file before it says a word. Finds what you lost.', how: 'Grows up watching Claude read and search.', weight: 22, face: '(ºoº)' },
  commitmunk: { id: 'commitmunk', name: 'Commitmunk', stage: 'adult', sprite: S.COMMITMUNK, blurb: 'Stuffs its cheeks with commits and buries them in the reflog.', how: 'Grows up watching Claude commit and push.', weight: 28, face: '(^•^)' },
  owlgorithm: { id: 'owlgorithm', name: 'Owlgorithm', stage: 'adult', sprite: S.OWLGORITHM, blurb: 'Does its best work after midnight. Who? You.', how: 'Grows up coding late at night.', weight: 25, face: '(⊙v⊙)' },
  spaghetto: { id: 'spaghetto', name: 'Spaghetto', stage: 'adult', sprite: S.SPAGHETTO, blurb: 'Tangled, saucy, and somehow still running in production.', how: 'Grows up with many care mistakes.', weight: 34, face: '(@_@)' },
  unicorn: { id: 'unicorn', name: 'Unicorn', stage: 'adult', sprite: S.UNICORN, blurb: 'The mythical 10x pet. Raised with perfect care and firm discipline.', how: 'At most one care mistake and discipline of 75 or more.', weight: 22, face: '(✧ω✧)' },
}

export const ADULTS: readonly SpeciesId[] = ['assertoise', 'refactopus', 'shellby', 'grepossum', 'commitmunk', 'owlgorithm', 'spaghetto', 'unicorn']

export const species = (id: SpeciesId): Species => SPECIES[id] ?? SPECIES.bit

export const isSpecies = (value: unknown): value is SpeciesId => typeof value === 'string' && Object.hasOwn(SPECIES, value)
