import { describe, expect, test } from 'claude-code/testing'
import {
  adultFor,
  CALL_GRACE,
  care,
  classify,
  DAY,
  DEPART_AFTER,
  endVacation,
  hearts,
  HOUR,
  MINUTE,
  NAP_AFTER,
  newPet,
  played,
  rename,
  startVacation,
  tick,
  touch,
  turnDone,
  work,
} from '../hooks/pet/life.ts'
import type { Pet } from '../types'
import { T0 } from './fixtures.ts'

const hatched = (over: Partial<Pet> = {}): Pet => ({ ...newPet(T0, { id: 'seed01', name: 'Mochi' }), species: 'bit', hatchedAt: T0, evolvedAt: T0, ...over })

describe('life', () => {
  test('an egg hatches after a minute once Claude has done something', () => {
    const egg = newPet(T0, { id: 'egg1' })
    expect(tick(egg, T0 + 30_000).pet.species).toBe('egg')
    // a minute alone is not enough: it waits for Claude's first tool call, or three minutes
    expect(tick(egg, T0 + MINUTE).pet.species).toBe('egg')
    const fed = work(egg, 'search', false, T0 + 10_000).pet
    const out = tick(fed, T0 + MINUTE)
    expect(out.pet.species).toBe('bit')
    expect(out.events).toContainEqual({ kind: 'hatched' })
    expect(tick(egg, T0 + 3 * MINUTE).pet.species).toBe('bit')
  })

  test('hunger and fun run down while awake, a tenth as fast asleep', () => {
    const pet = hatched({ lastActive: T0 + 10 * HOUR })
    const awake = tick(pet, T0 + 2 * HOUR).pet
    expect(Math.round(awake.hunger)).toBe(50)
    expect(Math.round(awake.happy)).toBeLessThan(65)
    const asleep = tick({ ...pet, asleep: true, tucked: true, lastActive: T0 }, T0 + 2 * HOUR).pet
    expect(Math.round(asleep.hunger)).toBe(95)
  })

  test('with nothing going on it naps, and work wakes it', () => {
    const pet = hatched()
    const later = tick(pet, T0 + NAP_AFTER + MINUTE)
    expect(later.pet.asleep).toBe(true)
    expect(later.events).toContainEqual({ kind: 'napped' })
    const { pet: woke, woke: didWake } = touch(later.pet, T0 + NAP_AFTER + 2 * MINUTE)
    expect(didWake).toBe(true)
    expect(woke.asleep).toBe(false)
    // tucked in, Claude's work does not wake it
    expect(touch({ ...later.pet, tucked: true }, T0 + NAP_AFTER + 2 * MINUTE).pet.asleep).toBe(true)
  })

  test('two sessions simulating the same pet reach the same pet', () => {
    const pet = hatched({ lastActive: T0 + 99 * HOUR })
    const a = tick(pet, T0 + 9 * HOUR).pet
    const b = tick(tick(tick(pet, T0 + 2 * HOUR).pet, T0 + 5 * HOUR).pet, T0 + 9 * HOUR).pet
    expect(b).toEqual(a)
  })

  test('a need left alone for a quarter of an awake hour is a care mistake', () => {
    const pet = hatched({ hunger: 0.1, lastActive: T0 + 99 * HOUR })
    const out = tick(pet, T0 + (CALL_GRACE + 2) * MINUTE)
    expect(out.events).toContainEqual({ kind: 'calling', need: 'hungry' })
    expect(out.events).toContainEqual({ kind: 'mistake', need: 'hungry' })
    expect(out.pet.mistakes).toBe(1)
    // counted once per call, not once a minute
    expect(tick(out.pet, T0 + 60 * MINUTE).pet.mistakes).toBe(1)
  })

  test('in classic mode, half an awake day of hard neglect and it leaves; gentle, never', () => {
    const pet = hatched({ hunger: 0, happy: 0, lastActive: T0 + 99 * DAY })
    const classic = tick(pet, T0 + DEPART_AFTER * MINUTE + 5 * MINUTE, 'classic')
    expect(classic.pet.gone?.cause).toBe('neglect')
    expect(classic.events).toContainEqual({ kind: 'departed' })
    expect(tick(pet, T0 + 3 * DAY, 'gentle').pet.gone).toBeNull()
  })

  test('a vacation stops its clock', () => {
    const away = startVacation(hatched(), T0)
    expect(tick(away, T0 + 5 * DAY).pet).toBe(away)
    const back = endVacation(away, T0 + 5 * DAY)
    expect(back.at).toBe(T0 + 5 * DAY)
    expect(back.hunger).toBe(100)
  })

  test('meals fill hunger a heart at a time, and a full pet refuses', () => {
    const pet = hatched({ hunger: 40 })
    const fed = care(pet, 'meal', T0)
    expect(fed.ok).toBe(true)
    expect(fed.reaction).toBe('eat')
    expect(hearts(fed.pet.hunger)).toBe(3)
    expect(fed.pet.weight).toBe(pet.weight + 1)
    const full = care({ ...pet, hunger: 100 }, 'meal', T0)
    expect(full.ok).toBe(false)
    expect(full.reaction).toBe('refuse')
  })

  test('a tantrum: food is refused, discipline ends it; scolding a good pet only hurts', () => {
    const pet = hatched({ tantrum: true })
    expect(care(pet, 'meal', T0).reaction).toBe('refuse')
    const scolded = care(pet, 'scold', T0)
    expect(scolded.pet.tantrum).toBe(false)
    expect(scolded.pet.discipline).toBe(25)
    const unfair = care(hatched(), 'scold', T0)
    expect(unfair.ok).toBe(false)
    expect(unfair.pet.happy).toBe(80)
  })

  test('medicine cures, a dose at a time; cleaning squashes every bug', () => {
    const sick = hatched({ sick: 2 })
    const once = care(sick, 'medicine', T0)
    expect(once.pet.sick).toBe(1)
    expect(care(once.pet, 'medicine', T0).pet.sick).toBe(0)
    const clean = care(hatched({ bugs: 3 }), 'clean', T0)
    expect(clean.pet.bugs).toBe(0)
    expect(clean.say).toBe('squashed 3 bugs')
  })

  test('lights tuck it in and wake it up', () => {
    const tucked = care(hatched(), 'lights', T0)
    expect(tucked.pet.asleep && tucked.pet.tucked).toBe(true)
    const woke = care(tucked.pet, 'lights', T0 + HOUR)
    expect(woke.pet.asleep).toBe(false)
    expect(woke.reaction).toBe('wake')
  })

  test('a game won lifts its mood a heart; any game burns a gram', () => {
    const pet = hatched({ happy: 30, weight: 9 })
    const won = played(pet, 4, T0)
    expect(won.reaction).toBe('win')
    expect(hearts(won.pet.happy)).toBe(3)
    expect(won.pet.weight).toBe(8)
    expect(played(pet, 1, T0).reaction).toBe('lose')
  })

  test("Claude's work: passing tests squash a bug, failing ones leave one", () => {
    const pet = hatched({ bugs: 1 })
    const pass = work(pet, 'test-pass', false, T0)
    expect(pass.pet.bugs).toBe(0)
    expect(pass.pet.stats.tests).toBe(1)
    const fail = work(pet, 'test-fail', false, T0)
    expect(fail.pet.bugs).toBe(2)
    expect(fail.reaction).toBe('flinch')
    expect(work(pet, 'commit', false, T0).reaction).toBe('party')
    expect(work(pet, 'edit', false, T0).pet.stats.edits).toBe(1)
  })

  test('tool calls are told apart', () => {
    expect(classify('Bash', 'bun test', true)?.work).toBe('test-pass')
    expect(classify('Bash', 'npx vitest run', false)?.work).toBe('test-fail')
    expect(classify('Bash', 'cargo nextest run', true)?.work).toBe('test-pass')
    expect(classify('Bash', 'claude plugin test', true)?.work).toBe('test-pass')
    expect(classify('Bash', 'git commit -m "fix"', true)?.work).toBe('commit')
    expect(classify('Bash', 'git commit --dry-run', true)?.work).toBe('shell')
    expect(classify('Bash', 'git push origin main', true)?.work).toBe('push')
    expect(classify('Bash', 'ls -la', false)).toEqual({ work: 'shell', isError: true })
    expect(classify('Edit', undefined, true)?.work).toBe('edit')
    expect(classify('Grep', undefined, true)?.work).toBe('search')
    expect(classify('Agent', undefined, true)?.work).toBe('agent')
    // a refused call feeds nothing
    expect(classify('Bash', 'bun test', undefined)).toBeNull()
  })

  test('it grows with age and with the work it watches', () => {
    let pet = hatched()
    pet = { ...pet, stats: { ...pet.stats, toolCalls: 39 }, lastActive: T0 + 99 * DAY }
    expect(tick(pet, T0 + HOUR + MINUTE).pet.species).toBe('bit')
    pet = { ...pet, stats: { ...pet.stats, toolCalls: 40 } }
    const child = tick(pet, T0 + HOUR + MINUTE, 'gentle')
    expect(child.pet.species).toBe('nibble')
    expect(child.events).toContainEqual({ kind: 'evolved', from: 'bit', to: 'nibble' })
  })

  test('the adult it becomes follows care first, then the work it watched most', () => {
    const teen = hatched({ species: 'bytey', mistakes: 3, discipline: 50 })
    const s = teen.stats
    expect(adultFor({ ...teen, stats: { ...s, tests: 60, edits: 100, searches: 200 } })).toBe('assertoise')
    expect(adultFor({ ...teen, stats: { ...s, edits: 400, searches: 300 } })).toBe('refactopus')
    expect(adultFor({ ...teen, stats: { ...s, shell: 300, searches: 200 } })).toBe('shellby')
    expect(adultFor({ ...teen, stats: { ...s, searches: 500, edits: 100 } })).toBe('grepossum')
    expect(adultFor({ ...teen, stats: { ...s, commits: 30, edits: 300 } })).toBe('commitmunk')
    expect(adultFor({ ...teen, stats: { ...s, turns: 40, nightTurns: 30 } })).toBe('owlgorithm')
    expect(adultFor({ ...teen, mistakes: 9 })).toBe('spaghetto')
    expect(adultFor({ ...teen, mistakes: 0, discipline: 75 })).toBe('unicorn')
  })

  test('late-night turns are counted', () => {
    const pet = turnDone(hatched(), 1200, 2, T0)
    expect(pet.stats).toMatchObject({ turns: 1, nightTurns: 1, tokens: 1200 })
    expect(turnDone(hatched(), 10, 14, T0).stats.nightTurns).toBe(0)
  })

  test('a name is kept short and plain', () => {
    expect(rename(hatched(), '  Sir <Bugs> A Lot the Third ').name).toBe('Sir Bugs A Lot t')
    expect(rename(hatched(), '<>').name).toBe('Mochi')
  })
})
