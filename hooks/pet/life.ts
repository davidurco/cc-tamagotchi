import type { Memorial, Need, Pet, PetStats, ReactionKind, Settings, SpeciesId } from '../../types'
import { newId, pick, roll } from './rng.ts'
import { species } from './species.ts'

// The pet's life, as pure functions of the pet and the time. Nothing here touches the engine:
// the hooks module reads the pet from $.store, runs it forward with `tick`, applies what the person
// did (`care`) and what Claude did (`work`), and writes it back.

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** No activity from Claude or the person for this long, and it naps. */
export const NAP_AFTER = 20 * MINUTE
/** Tucked in, it sleeps at most this long before it is just napping. */
const TUCK_MAX = 10 * HOUR
/** Full to empty in four awake hours; content to miserable in five. Asleep, a tenth as fast. */
const HUNGER_PER_MIN = 100 / (4 * 60)
const HAPPY_PER_MIN = 100 / (5 * 60)
const ASLEEP = 0.1
/** Awake minutes a call may go unanswered before it counts as a care mistake. */
export const CALL_GRACE = 15
/** Minutes of hard neglect before a pet leaves, in classic mode: half a day awake, days asleep. */
export const DEPART_AFTER = 12 * 60
/** A pet left alone longer than this is simulated from this far back only. */
const MAX_SIM = 30 * DAY
export const MAX_BUGS = 4

export const HATCH_AFTER = MINUTE
export const GROWTH: Record<'baby' | 'child' | 'teen', { age: number; toolCalls: number }> = {
  baby: { age: HOUR, toolCalls: 40 },
  child: { age: DAY, toolCalls: 250 },
  teen: { age: 3 * DAY, toolCalls: 800 },
}

const NAMES = ['Mochi', 'Pixel', 'Tofu', 'Bitsy', 'Dumpling', 'Biscuit', 'Momo', 'Kiwi', 'Taro', 'Pudding', 'Noodle', 'Sprout', 'Bean', 'Pico', 'Waffle', 'Nori', 'Gizmo', 'Peanut']

export const emptyStats = (): PetStats => ({
  toolCalls: 0, edits: 0, tests: 0, testFails: 0, commits: 0, pushes: 0, shell: 0, searches: 0, agents: 0, errors: 0,
  turns: 0, nightTurns: 0, tokens: 0, meals: 0, snacks: 0, games: 0, wins: 0, cleans: 0, meds: 0, pats: 0, scolds: 0,
})

export function newPet(now: number, opts: { name?: string; generation?: number; id?: string } = {}): Pet {
  const id = opts.id ?? newId(now)
  return {
    v: 1,
    id,
    name: opts.name ?? pick(NAMES, roll(id, 'name')),
    species: 'egg',
    generation: opts.generation ?? 1,
    born: now,
    hatchedAt: null,
    evolvedAt: now,
    at: now,
    hunger: 100,
    happy: 100,
    discipline: 0,
    weight: species('egg').weight,
    bugs: 0,
    sick: 0,
    asleep: false,
    tucked: false,
    lastActive: now,
    lastMeal: null,
    lastPat: 0,
    tantrum: false,
    calling: null,
    callWait: 0,
    callingCounted: false,
    mistakes: 0,
    neglect: 0,
    vacation: null,
    gone: null,
    rev: 0,
    stats: emptyStats(),
  }
}

/** Whether a value read back from the store is a pet this version can run. */
export function isPet(value: unknown): value is Pet {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<Pet>
  return p.v === 1 && typeof p.id === 'string' && typeof p.at === 'number' && typeof p.species === 'string' && typeof p.stats === 'object'
}

/** A pet from the store, with any field an older version did not write filled in. */
export function revive(value: Pet): Pet {
  const fresh = newPet(value.born ?? value.at, { id: value.id, name: value.name })
  return { ...fresh, ...value, stats: { ...emptyStats(), ...value.stats } }
}

// ── reading the pet ─────────────────────────────────────────────────────────────────────────

/** 0 to 4 hearts. Anything above an empty meter shows at least one. */
export const hearts = (value: number): number => Math.max(0, Math.min(4, Math.ceil(value / 25 - 1e-9)))

export const stageOf = (p: Pet) => species(p.species).stage

/** What it is calling about right now, most urgent first. */
export function needOf(p: Pet): Need | null {
  if (p.gone || p.species === 'egg') return null
  if (p.sick > 0) return 'sick'
  if (p.hunger <= 0) return 'hungry'
  if (p.happy <= 0) return 'sad'
  if (p.bugs >= 3) return 'bugs'
  if (p.tantrum) return 'tantrum'
  return null
}

export function ageText(ms: number): string {
  const m = Math.floor(ms / MINUTE)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export const ageOf = (p: Pet, now: number): number => (p.hatchedAt === null ? 0 : (p.gone?.at ?? now) - p.hatchedAt)

/** The next form it is growing towards and what is still missing, for the stats page. */
export function nextGrowth(p: Pet, now: number): string | null {
  const stage = stageOf(p)
  if (stage === 'egg') return 'hatches soon'
  if (stage === 'adult') return null
  const need = GROWTH[stage]
  const age = ageOf(p, now)
  const parts: string[] = []
  if (age < need.age) parts.push(`${ageText(need.age - age)} older`)
  if (p.stats.toolCalls < need.toolCalls) parts.push(`${need.toolCalls - p.stats.toolCalls} more tool calls`)
  return parts.length ? `grows after ${parts.join(' and ')}` : 'about to grow'
}

// ── time ────────────────────────────────────────────────────────────────────────────────────

export type LifeEvent =
  | { kind: 'hatched' }
  | { kind: 'evolved'; from: SpeciesId; to: SpeciesId }
  | { kind: 'bug' }
  | { kind: 'sick' }
  | { kind: 'tantrum' }
  | { kind: 'calling'; need: Need }
  | { kind: 'mistake'; need: Need }
  | { kind: 'napped' }
  | { kind: 'departed' }

const clone = (p: Pet): Pet => ({ ...p, stats: { ...p.stats } })

/**
 * Runs the pet's life forward to `now`, a whole minute at a time, and says what happened.
 * Pure and deterministic: every roll is seeded by the pet's id and the minute.
 */
export function tick(p: Pet, now: number, mode: Settings['mode'] = 'classic'): { pet: Pet; events: LifeEvent[] } {
  const events: LifeEvent[] = []
  if (p.gone || p.vacation !== null) return { pet: p, events }
  const pet = clone(p)

  if (pet.species === 'egg') {
    pet.at = Math.max(pet.at, now)
    hatch(pet, now, events)
    return events.length ? { pet, events } : { pet: now > p.at ? pet : p, events }
  }

  if (now - pet.at > MAX_SIM) pet.at = now - MAX_SIM
  const steps = Math.max(0, Math.floor((now - pet.at) / MINUTE))
  for (let i = 0; i < steps && !pet.gone; i++) {
    minute(pet, pet.at + MINUTE, mode, events)
    pet.at += MINUTE
  }
  if (!pet.gone) grow(pet, now, events)
  return steps > 0 || events.length > 0 ? { pet, events } : { pet: p, events }
}

function hatch(pet: Pet, now: number, events: LifeEvent[]): void {
  const waited = now - pet.born
  if (waited >= HATCH_AFTER && (pet.stats.toolCalls >= 1 || waited >= 3 * MINUTE)) {
    pet.species = 'bit'
    pet.hatchedAt = now
    pet.evolvedAt = now
    pet.lastActive = Math.max(pet.lastActive, now)
    pet.weight = species('bit').weight
    events.push({ kind: 'hatched' })
  }
}

function minute(pet: Pet, t: number, mode: Settings['mode'], events: LifeEvent[]): void {
  const m = Math.floor(t / MINUTE)

  // sleep: a nap after a while with nothing going on; a tucked-in pet sleeps through Claude's work
  if (pet.tucked && t - pet.lastActive >= TUCK_MAX) pet.tucked = false
  if (!pet.asleep && t - pet.lastActive >= NAP_AFTER) {
    pet.asleep = true
    events.push({ kind: 'napped' })
  }
  const f = pet.asleep ? ASLEEP : 1

  pet.hunger = Math.max(0, pet.hunger - HUNGER_PER_MIN * f * (pet.sick ? 1.25 : 1))
  pet.happy = Math.max(0, pet.happy - HAPPY_PER_MIN * f * (1 + 0.25 * pet.bugs) * (pet.sick ? 2 : 1))

  // bugs: one about half an hour after each meal, and now and then while awake
  if (pet.lastMeal !== null) {
    const due = pet.lastMeal + (28 + Math.floor(roll(pet.id, pet.lastMeal, 'digest') * 17)) * MINUTE
    if (t >= due && t - MINUTE < due) addBug(pet, events)
  }
  if (!pet.asleep && roll(pet.id, m, 'bug') < 1 / 150) addBug(pet, events)

  // sickness: bugs left lying around, starving, or too many snacks
  if (pet.sick === 0) {
    let risk = 0
    if (pet.bugs >= 2) risk += 0.002 * pet.bugs
    if (pet.hunger <= 0) risk += 0.004
    if (pet.weight > species(pet.species).weight * 1.6) risk += 0.001
    if (roll(pet.id, m, 'sick') < risk * f) {
      pet.sick = roll(pet.id, m, 'doses') < 0.35 ? 2 : 1
      pet.tantrum = false
      events.push({ kind: 'sick' })
    }
  }

  // a tantrum: calling for nothing, which is what discipline is for
  const isLittle = pet.species === 'bit'
  if (!pet.asleep && !pet.tantrum && !isLittle && pet.sick === 0 && pet.hunger > 50 && pet.happy > 50 && pet.discipline < 100) {
    if (roll(pet.id, m, 'tantrum') < 1 / 300) {
      pet.tantrum = true
      events.push({ kind: 'tantrum' })
    }
  }

  // calls: one left unanswered for a quarter of an awake hour is a care mistake
  const need = needOf(pet)
  if (need !== pet.calling) {
    pet.calling = need
    pet.callWait = 0
    pet.callingCounted = false
    if (need) events.push({ kind: 'calling', need })
  } else if (need) {
    pet.callWait += f
    if (!pet.callingCounted && pet.callWait >= CALL_GRACE) {
      pet.mistakes += 1
      pet.callingCounted = true
      events.push({ kind: 'mistake', need })
      // an ignored tantrum blows over
      if (need === 'tantrum') pet.tantrum = false
    }
  }

  // hard neglect: starving and miserable, or sick. In classic mode, half an awake day of it and it leaves.
  // Gentle mode counts none of it, so switching to classic starts the count from nothing.
  const isHard = (pet.hunger <= 0 && pet.happy <= 0) || pet.sick > 0
  if (mode === 'gentle') pet.neglect = 0
  else pet.neglect = isHard ? Math.min(DEPART_AFTER, pet.neglect + f) : Math.max(0, pet.neglect - f / 2)
  if (mode === 'classic' && isHard && pet.neglect >= DEPART_AFTER) {
    pet.gone = { at: t, cause: 'neglect' }
    pet.asleep = false
    pet.calling = null
    events.push({ kind: 'departed' })
  }
}

function addBug(pet: Pet, events: LifeEvent[]): void {
  if (pet.bugs >= MAX_BUGS) return
  pet.bugs += 1
  events.push({ kind: 'bug' })
}

/** Grows into the next form once it is old enough and has watched enough of Claude's work. */
function grow(pet: Pet, now: number, events: LifeEvent[]): void {
  const stage = stageOf(pet)
  if (stage === 'egg' || stage === 'adult') return
  const need = GROWTH[stage]
  if (ageOf(pet, now) < need.age || pet.stats.toolCalls < need.toolCalls) return
  const from = pet.species
  const to: SpeciesId = stage === 'baby' ? 'nibble' : stage === 'child' ? (pet.mistakes <= 3 ? 'bytey' : 'glitchy') : adultFor(pet)
  pet.weight = Math.max(1, pet.weight + species(to).weight - species(from).weight)
  pet.species = to
  pet.evolvedAt = now
  events.push({ kind: 'evolved', from, to })
}

/** Which adult a teen becomes: care first, then the work it watched Claude do the most of. */
export function adultFor(pet: Pet): SpeciesId {
  const s = pet.stats
  if (pet.mistakes >= 8 || (pet.species === 'glitchy' && pet.mistakes >= 6)) return 'spaghetto'
  if (pet.mistakes <= 1 && pet.discipline >= 75) return 'unicorn'
  if (s.turns >= 20 && s.nightTurns / s.turns >= 0.4) return 'owlgorithm'
  // weighted so a habit counts for what it is, not for how often a tool happens to be called
  const scores: [SpeciesId, number][] = [
    ['grepossum', s.searches],
    ['refactopus', s.edits * 1.5],
    ['shellby', s.shell * 1.3],
    ['assertoise', (s.tests + s.testFails) * 6],
    ['commitmunk', s.commits * 25 + s.pushes * 15],
  ]
  return scores.reduce((best, one) => (one[1] > best[1] ? one : best))[0]
}

/** After care or work, what it calls about is what it needs now: a fed pet stops calling hungry at once. */
function settle(out: Outcome): Outcome {
  const pet = out.pet
  const need = needOf(pet)
  if (need === pet.calling) return out
  return { ...out, pet: { ...pet, calling: need, callWait: 0, callingCounted: false } }
}

// ── the person's care ───────────────────────────────────────────────────────────────────────

export type Care = 'meal' | 'snack' | 'clean' | 'medicine' | 'lights' | 'scold' | 'pat'

export type Outcome = { pet: Pet; reaction?: ReactionKind; say?: string; ok: boolean }

/** What the person did. The pet is assumed ticked to `now` already. */
export function care(p: Pet, what: Care, now: number): Outcome {
  return settle(careFor(p, what, now))
}

function careFor(p: Pet, what: Care, now: number): Outcome {
  if (p.gone) return { pet: p, ok: false, say: `${p.name} is not here any more` }
  if (p.species === 'egg') return { pet: p, ok: false, say: 'it is still an egg: give it a minute' }
  const pet = clone(p)
  const name = pet.name

  // anything but the lights and a pat wakes it
  if (what !== 'lights' && what !== 'pat' && pet.asleep) {
    pet.asleep = false
    pet.tucked = false
  }
  if (what !== 'lights') pet.lastActive = Math.max(pet.lastActive, now)

  switch (what) {
    case 'meal': {
      if (pet.tantrum) return { pet, ok: false, reaction: 'refuse', say: `${name} won't eat. A tantrum: try discipline` }
      if (pet.hunger >= 100) return { pet, ok: false, reaction: 'refuse', say: `${name} is full` }
      pet.hunger = Math.min(100, pet.hunger + 25)
      pet.weight += 1
      pet.lastMeal = now
      pet.stats.meals += 1
      return { pet, ok: true, reaction: 'eat', say: pick(['*munch munch*', 'nom nom nom', 'tasty!', 'rice ball!'], roll(pet.id, now, 'say')) }
    }
    case 'snack': {
      if (pet.tantrum) return { pet, ok: false, reaction: 'refuse', say: `${name} throws the candy away. A tantrum: try discipline` }
      pet.happy = Math.min(100, pet.happy + 25)
      pet.hunger = Math.min(100, pet.hunger + 5)
      pet.weight += 2
      pet.stats.snacks += 1
      return { pet, ok: true, reaction: 'snack', say: pick(['sweet!!', 'yum, sugar', '*crunch*', 'more?'], roll(pet.id, now, 'say')) }
    }
    case 'clean': {
      if (pet.bugs === 0) return { pet, ok: false, reaction: 'clean', say: 'already squeaky clean' }
      const n = pet.bugs
      pet.bugs = 0
      pet.happy = Math.min(100, pet.happy + 4)
      pet.stats.cleans += 1
      return { pet, ok: true, reaction: 'clean', say: n === 1 ? 'squashed the bug' : `squashed ${n} bugs` }
    }
    case 'medicine': {
      if (pet.sick === 0) {
        pet.happy = Math.max(0, pet.happy - 5)
        return { pet, ok: false, reaction: 'refuse', say: `${name} is not sick, and medicine tastes awful` }
      }
      pet.sick -= 1
      pet.stats.meds += 1
      return { pet, ok: true, reaction: 'medicine', say: pet.sick === 0 ? `${name} feels better` : 'one more dose to go' }
    }
    case 'lights': {
      if (pet.asleep) {
        pet.asleep = false
        pet.tucked = false
        pet.lastActive = Math.max(pet.lastActive, now)
        return { pet, ok: true, reaction: 'wake', say: 'good morning!' }
      }
      pet.asleep = true
      pet.tucked = true
      pet.lastActive = now
      return { pet, ok: true, reaction: 'sleep', say: 'lights out. zzz' }
    }
    case 'scold': {
      if (pet.tantrum) {
        pet.tantrum = false
        pet.discipline = Math.min(100, pet.discipline + 25)
        pet.stats.scolds += 1
        return { pet, ok: true, reaction: 'scold', say: `${name} behaves now` }
      }
      pet.happy = Math.max(0, pet.happy - 20)
      return { pet, ok: false, reaction: 'scold', say: `${name} did nothing wrong. :(` }
    }
    case 'pat': {
      if (pet.asleep) return { pet, ok: false, say: 'shh, it is sleeping' }
      if (now - pet.lastPat < 5_000) return { pet, ok: false, reaction: 'pat' }
      pet.happy = Math.min(100, pet.happy + 2)
      pet.lastPat = now
      pet.lastActive = Math.max(pet.lastActive, now)
      pet.stats.pats += 1
      return { pet, ok: true, reaction: 'pat', say: pick(['♥', 'hehe', 'purr…', '*wiggles*'], roll(pet.id, now, 'say')) }
    }
  }
}

/** Whether a game can start, and why not. */
export function canPlay(p: Pet): string | null {
  if (p.gone) return `${p.name} is not here any more`
  if (p.species === 'egg') return 'it is still an egg'
  if (p.sick > 0) return `${p.name} is too sick to play`
  if (p.hunger <= 0) return `${p.name} is too hungry to play`
  return null
}

/** A finished game of five rounds. Three wins lift its mood; any game burns a gram. */
export function played(p: Pet, wins: number, now: number): Outcome {
  return settle(playedFor(p, wins, now))
}

function playedFor(p: Pet, wins: number, now: number): Outcome {
  const pet = clone(p)
  pet.asleep = false
  pet.tucked = false
  pet.lastActive = Math.max(pet.lastActive, now)
  pet.stats.games += 1
  pet.weight = Math.max(species(pet.species).weight - 5, pet.weight - 1)
  pet.hunger = Math.max(0, pet.hunger - 4)
  if (wins >= 3) {
    pet.happy = Math.min(100, pet.happy + 25)
    pet.stats.wins += 1
    return { pet, ok: true, reaction: 'win', say: `won ${wins} of 5!` }
  }
  pet.happy = Math.min(100, pet.happy + 5)
  return { pet, ok: true, reaction: 'lose', say: `${wins} of 5. again?` }
}

export function rename(p: Pet, name: string): Pet {
  const clean = name.replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16)
  return clean ? { ...p, name: clean } : p
}

export function startVacation(p: Pet, now: number): Pet {
  return p.vacation !== null || p.gone ? p : { ...p, vacation: now }
}

/** Ends a vacation: the time away never happened, so its age and its growth skip it too. */
export function endVacation(p: Pet, now: number): Pet {
  if (p.vacation === null) return p
  const away = Math.max(0, now - p.vacation)
  return {
    ...p,
    vacation: null,
    born: p.born + away,
    hatchedAt: p.hatchedAt === null ? null : p.hatchedAt + away,
    evolvedAt: p.evolvedAt + away,
    at: now,
    lastActive: now,
    asleep: false,
    tucked: false,
    lastMeal: null,
  }
}

export function memorialOf(p: Pet): Memorial {
  return {
    name: p.name,
    species: p.species,
    generation: p.generation,
    born: p.born,
    gone: p.gone?.at ?? p.at,
    toolCalls: p.stats.toolCalls,
    commits: p.stats.commits,
  }
}

/** The next generation: a new egg, the old pet's name kept unless the person gives another. */
export const nextEgg = (p: Pet, now: number): Pet => newPet(now, { generation: p.generation + 1 })

// ── Claude's work ───────────────────────────────────────────────────────────────────────────

export type Work = 'edit' | 'test-pass' | 'test-fail' | 'commit' | 'push' | 'shell' | 'search' | 'agent' | 'other'

const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SEARCHES = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'NotebookRead', 'ToolSearch'])
const AGENTS = new Set(['Task', 'Agent'])
const SHELLS = new Set(['Bash', 'PowerShell'])

// Test runners across the usual stacks, matched where a command starts (after any `cd x &&`, an
// env assignment or `npx`), so `cat jest.config.js` or a commit message that names pytest is not a run.
const TEST_START =
  /^(?:(?:npx|bunx|pnpx|pnpm\s+(?:exec|dlx)|yarn\s+(?:exec|dlx)|uv\s+run|poetry\s+run|pipenv\s+run|hatch\s+run)\s+)?(?:jest|vitest|mocha|ava|tap|pytest|rspec|phpunit|tox|nox|ctest|playwright\s+test)\b|^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|^python3?\s+-m\s+(?:pytest|unittest)\b|^go\s+test\b|^cargo\s+(?:test|nextest)\b|^make\s+(?:test|check)\b|^(?:\.\/)?(?:mvn|mvnw|gradle|gradlew|sbt)\b.*\btest\b|^dotnet\s+test\b|^mix\s+test\b|^deno\s+test\b|^swift\s+test\b|^(?:claude\s+)?plugin\s+test\b/

/** The commands of a shell line, each without leading env assignments or wrappers. */
export function commandsOf(line: string): string[] {
  return line
    .split(/&&|\|\||;|\||\n/)
    .map(part =>
      part
        .trim()
        .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '')
        .replace(/^(?:time|sudo|exec|env|command|nice)\s+/, ''),
    )
    .filter(Boolean)
}

const isGit = (part: string, verb: string) => new RegExp(`^git\\s+(?:-C\\s+\\S+\\s+|-c\\s+\\S+\\s+)*${verb}\\b`).test(part) && !/--dry-run\b/.test(part)

/**
 * What a finished tool call was, for the pet: `ok` is false when the tool failed and undefined
 * when the call was refused (which feeds nothing). Shell lines are read command by command.
 */
export function classify(tool: string, command: string | undefined, ok: boolean | undefined): { work: Work; isError: boolean } | null {
  if (ok === undefined) return null
  if (SHELLS.has(tool) && command) {
    const parts = commandsOf(command)
    if (ok && parts.some(part => isGit(part, 'commit'))) return { work: 'commit', isError: false }
    if (ok && parts.some(part => isGit(part, 'push'))) return { work: 'push', isError: false }
    if (parts.some(part => TEST_START.test(part))) return { work: ok ? 'test-pass' : 'test-fail', isError: false }
    return { work: 'shell', isError: !ok }
  }
  if (EDITS.has(tool)) return { work: ok ? 'edit' : 'other', isError: !ok }
  if (SEARCHES.has(tool)) return { work: 'search', isError: !ok }
  if (AGENTS.has(tool)) return { work: 'agent', isError: !ok }
  return { work: 'other', isError: !ok }
}

/** Claude or the person was active: a napping pet wakes (a tucked-in one sleeps on). */
export function touch(p: Pet, now: number): { pet: Pet; woke: boolean } {
  if (p.gone) return { pet: p, woke: false }
  const woke = p.asleep && !p.tucked
  return { pet: { ...p, lastActive: Math.max(p.lastActive, now), asleep: woke ? false : p.asleep }, woke }
}

/** One tool call Claude finished. The pet is assumed ticked to `now` already. */
export function work(p: Pet, w: Work, isError: boolean, now: number): Outcome {
  return settle(workFor(p, w, isError, now))
}

function workFor(p: Pet, w: Work, isError: boolean, now: number): Outcome {
  if (p.gone) return { pet: p, ok: false }
  const pet = touch(clone(p), now).pet
  const s = pet.stats
  s.toolCalls += 1
  if (isError) s.errors += 1
  const isEgg = pet.species === 'egg'
  const awake = !pet.asleep

  switch (w) {
    case 'edit':
      s.edits += 1
      if (!isEgg) pet.hunger = Math.min(100, pet.hunger + 1)
      return { pet, ok: true, reaction: awake ? 'nibble' : undefined }
    case 'test-pass':
      s.tests += 1
      if (isEgg) return { pet, ok: true }
      pet.happy = Math.min(100, pet.happy + 6)
      if (pet.bugs > 0) {
        pet.bugs -= 1
        return { pet, ok: true, reaction: 'cheer', say: 'the tests squashed a bug!' }
      }
      return { pet, ok: true, reaction: awake ? 'cheer' : undefined, say: awake ? pick(['tests pass! ♪', 'all green ♪', 'yay, green!'], roll(pet.id, now, 'say')) : undefined }
    case 'test-fail':
      s.testFails += 1
      if (isEgg) return { pet, ok: true }
      pet.happy = Math.max(0, pet.happy - 4)
      pet.bugs = Math.min(MAX_BUGS, pet.bugs + 1)
      return { pet, ok: true, reaction: 'flinch', say: pick(['a bug crawled out of the tests!', 'red… a bug!', 'eek, failing tests'], roll(pet.id, now, 'say')) }
    case 'commit':
      s.commits += 1
      if (isEgg) return { pet, ok: true }
      pet.happy = Math.min(100, pet.happy + 12)
      pet.hunger = Math.min(100, pet.hunger + 3)
      return { pet, ok: true, reaction: 'party', say: pick(['committed! party!', 'into the reflog it goes ♪', 'ship it!'], roll(pet.id, now, 'say')) }
    case 'push':
      s.pushes += 1
      if (isEgg) return { pet, ok: true }
      pet.happy = Math.min(100, pet.happy + 8)
      return { pet, ok: true, reaction: 'party', say: 'pushed! wheee' }
    case 'shell':
      s.shell += 1
      return { pet, ok: true, reaction: isError && awake && !isEgg ? 'flinch' : undefined }
    case 'search':
      s.searches += 1
      return { pet, ok: true }
    case 'agent':
      s.agents += 1
      return { pet, ok: true }
    case 'other':
      return { pet, ok: true, reaction: isError && awake && !isEgg ? 'flinch' : undefined }
  }
}

/** A turn of Claude's ended: count it, the tokens it wrote, and whether it was late at night. */
export function turnDone(p: Pet, tokens: number, hour: number, now: number): Pet {
  if (p.gone) return p
  const pet = touch(clone(p), now).pet
  pet.stats.turns += 1
  pet.stats.tokens += Math.max(0, Math.round(tokens))
  if (hour >= 23 || hour < 5) pet.stats.nightTurns += 1
  return pet
}
