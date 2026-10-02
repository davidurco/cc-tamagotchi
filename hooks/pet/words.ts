import type { Need, Pet } from '../../types'
import { hearts, stageOf } from './life.ts'
import { species } from './species.ts'

// What the pet looks like and says in text: its face, its meters, the line about how it is doing.

export const meter = (value: number, full = '♥', empty = '♡'): string => full.repeat(hearts(value)) + empty.repeat(4 - hearts(value))

/** Discipline as four bars. */
export const bars = (value: number): string => '■'.repeat(hearts(value)) + '□'.repeat(4 - hearts(value))

/** Its face as text: for the spinner and the one-line band. */
export function face(p: Pet): string {
  if (p.gone) return '(  )'
  if (p.species === 'egg') return '( )'
  if (p.asleep) return '(-_-)zZ'
  if (p.sick > 0) return '(×_×)'
  if (p.tantrum) return '(ò_ó)'
  if (p.hunger <= 0 || p.happy <= 0) return '(;_;)'
  if (p.happy < 40) return '(._.)'
  return species(p.species).face
}

export const NEED_TEXT: Record<Need, string> = {
  hungry: 'is hungry',
  sad: 'is bored and sad',
  sick: 'is sick: medicine!',
  bugs: 'is surrounded by bugs',
  tantrum: 'is throwing a tantrum',
}

/** One line about how it is doing, most pressing first. */
export function statusLine(p: Pet): string {
  if (p.gone) return `${p.name} has left for the cloud. /tama new for a new egg`
  if (p.vacation !== null) return `${p.name} is on vacation. /tama vacation off when you are back`
  if (p.species === 'egg') return 'an egg. it hatches when Claude gets to work'
  if (p.calling) return `${p.name} ${NEED_TEXT[p.calling]}`
  if (p.tucked) return `${p.name} is tucked in`
  if (p.asleep) return `${p.name} is napping`
  if (p.bugs > 0) return `${p.name} left ${p.bugs === 1 ? 'a bug' : `${p.bugs} bugs`} behind`
  if (p.hunger < 30) return `${p.name} is getting peckish`
  if (p.happy < 30) return `${p.name} wants to play`
  return `${p.name} is ${p.happy >= 75 ? 'happy' : 'doing fine'}`
}

export function title(p: Pet): string {
  const s = species(p.species)
  return stageOf(p) === 'egg' ? 'an egg' : `${p.name} the ${s.name}`
}

export const compact = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

/** What the pet says when a need starts calling. */
export const CALL_SAYS: Record<Need, string> = {
  hungry: 'my tummy is empty…',
  sad: 'play with me?',
  sick: 'i feel funny… (×_×)',
  bugs: 'so… many… bugs',
  tantrum: 'NO NO NO NO',
}

export const HELP: readonly [string, string][] = [
  ['/tama', 'open or close the device'],
  ['/tama feed · snack', 'a meal fills a heart of hunger, a snack a heart of fun'],
  ['/tama play', 'the left-or-right game: win 3 of 5'],
  ['/tama clean', 'squash the bugs it left behind'],
  ['/tama medicine', 'cure it when it is sick (sometimes twice)'],
  ['/tama lights', 'tuck it in, or wake it up'],
  ['/tama scold', 'discipline a tantrum (never a well-behaved pet)'],
  ['/tama stats · history', 'its life in numbers, and the pets before it'],
  ['/tama name <name>', 'rename it'],
  ['/tama shell <color>', 'coral, mint, grape, sky, banana or ink'],
  ['/tama band auto|big|on|line|off', 'how it shows above the prompt'],
  ['/tama vacation on|off', 'stop its clock while you are away'],
  ['/tama mode classic|gentle', 'gentle: it never leaves, however neglected'],
  ['/tama spinner · sound on|off', 'its face beside the spinner; beeps'],
]
