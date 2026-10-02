/* @jsx h */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { BandMode, Game, Memorial, Pet, Reaction, ReactionKind, Settings, ShellColor, Speech, View } from '../types'
import {
  ageOf,
  ageText,
  canPlay,
  care,
  classify,
  endVacation,
  hearts,
  isPet,
  memorialOf,
  newPet,
  nextEgg,
  nextGrowth,
  played,
  rename,
  revive,
  startVacation,
  tick,
  turnDone,
  work,
  type Care,
  type LifeEvent,
  type Outcome,
} from './pet/life.ts'
import { REACTION_MS, type SceneInput } from './pet/scene.ts'
import { species } from './pet/species.ts'
import { deviceSvg, LCD, laneSvg, SHELLS } from './pet/svg.ts'
import { bars, CALL_SAYS, compact, face, HELP, meter, NEED_TEXT, statusLine, title } from './pet/words.ts'

// cc-tamagotchi: a virtual pet that lives in Claude Code. It hatches from an egg, eats the work
// Claude does, leaves bugs behind, gets sick, throws tantrums and grows into one of eight adults
// depending on how it is cared for and what kind of work it watches. One pet per machine, kept in
// $.store and shared by every session; nothing it does reaches the model, so it costs no tokens.
//
// This module owns the pet: it runs its life forward (./pet/life.ts), applies Claude's tool calls
// and the person's care, and draws it: the device in a pane (/tama), the band above the prompt,
// a face beside the spinner. In the terminal the screen is ./lcd.tsx, a Client that animates on the
// drawing thread; the desktop and mobile apps get one animated SVG (./pet/svg.ts).

type Engine = EngineInterface

const PANE = 'tama'
const SPEECH_MS = 9_000
/** In `auto`, how long the band stays big after something happened. */
const BAND_AFTER_MS = 12_000
const TICK_MS = 30_000

const DEFAULT_SETTINGS: Settings = { band: 'auto', spinner: true, sound: false, mode: 'classic', shell: 'coral' }

const petAtom = atom({ plugin: 'cc-tamagotchi', key: 'pet' } as const, null)
const settingsAtom = atom({ plugin: 'cc-tamagotchi', key: 'settings' } as const, DEFAULT_SETTINGS)
const viewAtom = atom({ plugin: 'cc-tamagotchi', key: 'view' } as const, 'main')
const gameAtom = atom({ plugin: 'cc-tamagotchi', key: 'game' } as const, null)
const reactionAtom = atom({ plugin: 'cc-tamagotchi', key: 'reaction' } as const, null)
const speechAtom = atom({ plugin: 'cc-tamagotchi', key: 'speech' } as const, null)
const workingAtom = atom({ plugin: 'cc-tamagotchi', key: 'working' } as const, false)
const graveAtom = atom({ plugin: 'cc-tamagotchi', key: 'graveyard' } as const, [])

const BANDS: readonly BandMode[] = ['auto', 'big', 'on', 'line', 'off']
const COLORS = Object.keys(SHELLS) as ShellColor[]

// one change to the pet at a time in this session; sessions side by side meet in the store
let queue: Promise<unknown> = Promise.resolve()

const isSettings = (v: unknown): v is Partial<Settings> => typeof v === 'object' && v !== null

/** Whether the device is on screen: the engine's record, which outlives a reload of this module. */
async function isPaneUp($: Engine): Promise<boolean> {
  const panes = await $.ui.panes().catch(() => [])
  return panes.some(pane => pane.id === PANE && pane.isShown && pane.isPlaced)
}

// ── the pet in the store ────────────────────────────────────────────────────────────────────

async function loadSettings($: Engine): Promise<Settings> {
  const saved = await $.store.get('settings').catch(() => undefined)
  const settings = { ...DEFAULT_SETTINGS, ...(isSettings(saved) ? saved : {}) }
  await update($, settingsAtom, () => settings)
  return settings
}

async function saveSettings($: Engine, patch: Partial<Settings>): Promise<Settings> {
  const settings = { ...(await read($, settingsAtom)), ...patch }
  await update($, settingsAtom, () => settings)
  await $.store.set('settings', settings).catch(err => $.ui.log(`cc-tamagotchi: settings not saved: ${err}`, { to: 'debug' }))
  return settings
}

async function loadGraveyard($: Engine): Promise<Memorial[]> {
  const saved = await $.store.get('graveyard').catch(() => undefined)
  const list = Array.isArray(saved) ? (saved as Memorial[]) : []
  await update($, graveAtom, () => list)
  return list
}

/**
 * The one way the pet changes: read the newest copy from the store (another session may have
 * written it), run it forward to now, apply `fn`, write it back, show it, and play what happened.
 */
function change($: Engine, fn: ((pet: Pet, now: number) => Outcome | null) | null): Promise<Outcome | null> {
  const run = async (): Promise<Outcome | null> => {
    const now = await $.clock.now()
    const settings = await read($, settingsAtom)
    const saved = await $.store.get('pet').catch(() => undefined)
    const stored = isPet(saved) ? revive(saved) : newPet(now)
    const { pet: ticked, events } = tick(stored, now, settings.mode)
    const out = fn ? fn(ticked, now) : null
    // what the change brings about at once: the tool call that hatches the egg, the one that grows it
    const after = out ? tick(out.pet, now, settings.mode) : { pet: ticked, events: [] }
    events.push(...after.events)
    const pet = after.pet
    const isNew = !isPet(saved) || JSON.stringify(pet) !== JSON.stringify(stored)
    const next = isNew ? { ...pet, rev: stored.rev + 1 } : stored
    if (isNew) await $.store.set('pet', next).catch(err => $.ui.log(`cc-tamagotchi: pet not saved: ${err}`, { to: 'debug' }))
    await update($, petAtom, () => next)
    await announce($, events, next, settings)
    if (out?.reaction) await react($, out.reaction)
    if (out?.say) await say($, out.say)
    return out
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}

async function react($: Engine, kind: ReactionKind, from?: Reaction['from']): Promise<void> {
  const now = await $.clock.now()
  await update($, reactionAtom, (r: Reaction | null) => ({ kind, id: (r?.id ?? 0) + 1, at: now, ...(from ? { from } : {}) }))
  // the SVG surfaces play a reaction once, then need the idle loop drawn back
  $.clock.after(REACTION_MS[kind] + 80, () => $.ui.invalidate('ui.render'))
}

async function say($: Engine, text: string): Promise<void> {
  const now = await $.clock.now()
  await update($, speechAtom, () => ({ text, at: now }))
  $.clock.after(SPEECH_MS + 80, () => $.ui.invalidate('ui.render'))
}

function beep($: Engine, settings: Settings): void {
  if (settings.sound) $.audio.play({ asset: 'fx/beep.wav' }).catch(() => undefined)
}

/** What the simulation reported: toasts for the big moments, words for the small ones. */
async function announce($: Engine, events: LifeEvent[], pet: Pet, settings: Settings): Promise<void> {
  for (const ev of events) {
    switch (ev.kind) {
      case 'hatched':
        await react($, 'hatch')
        await say($, 'hello, world!')
        $.ui.toast(`${pet.name} hatched! Say hi with /tama`)
        beep($, settings)
        break
      case 'evolved':
        await react($, 'evolve', ev.from)
        await say($, `i'm a ${species(ev.to).name} now!`)
        $.ui.toast(`${pet.name} grew into a ${species(ev.to).name}!`, { timeoutMs: 8000 })
        beep($, settings)
        break
      case 'sick':
        $.ui.toast(`${pet.name} is sick. /tama medicine`)
        break
      case 'calling':
        await say($, CALL_SAYS[ev.need])
        beep($, settings)
        break
      case 'departed': {
        const list = [...(await read($, graveAtom)), memorialOf(pet)].slice(-50)
        await update($, graveAtom, () => list)
        await $.store.set('graveyard', list).catch(() => undefined)
        $.ui.toast(`${pet.name} has left for the cloud. /tama to see`, { timeoutMs: 10000 })
        break
      }
      case 'bug':
        if (!pet.asleep) await say($, 'oops… a bug')
        break
      default:
        break
    }
  }
}

// ── what the person does ────────────────────────────────────────────────────────────────────

async function doCare($: Engine, what: Care): Promise<void> {
  const out = await change($, (pet, now) => care(pet, what, now))
  if (out && !out.ok && out.say && !out.reaction) $.ui.toast(out.say)
}

async function startGame($: Engine): Promise<void> {
  const pet = await read($, petAtom)
  const why = pet ? canPlay(pet) : 'no pet yet'
  if (why) {
    $.ui.toast(why)
    return
  }
  await update($, gameAtom, () => ({ round: 0, wins: 0, answer: null, guess: null, isOver: false }))
  await update($, viewAtom, () => 'game')
}

async function guess($: Engine, dir: 'left' | 'right'): Promise<void> {
  const game = await read($, gameAtom)
  if (!game || game.isOver) return
  const answer: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right'
  const next: Game = { round: game.round + 1, wins: game.wins + (answer === dir ? 1 : 0), answer, guess: dir, isOver: game.round + 1 >= 5 }
  await update($, gameAtom, () => next)
  if (next.isOver) await change($, (pet, now) => played(pet, next.wins, now))
  else await react($, answer === dir ? 'pat' : 'lose')
}

async function setView($: Engine, view: View): Promise<void> {
  if (view !== 'game') await update($, gameAtom, () => null)
  await update($, viewAtom, () => view)
}

async function newEgg($: Engine): Promise<void> {
  await change($, (pet, now) => (pet.gone ? { pet: nextEgg(pet, now), ok: true, say: 'a new egg!' } : null))
  await setView($, 'main')
}

async function openPane($: Engine, view?: View): Promise<void> {
  if (view) await setView($, view)
  const pet = await read($, petAtom)
  // inline it asks for room for the screen and its buttons; docked, for the doubled screen
  await $.ui.open({ id: PANE, title: pet ? pet.name : 'tamagotchi', focus: true, rows: 22, columns: 72 })
  $.ui.invalidate('ui.render')
}

/** A key: a button's hotkey, or a key pressed on the screen once clicked. */
async function press($: Engine, key: string): Promise<void> {
  const view = await read($, viewAtom)
  const pet = await read($, petAtom)
  if (view === 'game') {
    const game = await read($, gameAtom)
    if (key === 'left' || key === 'a') return guess($, 'left')
    if (key === 'right' || key === 'd') return guess($, 'right')
    if (key === 'p' && game?.isOver) return startGame($)
    if (key === 'x' || key === 'b' || key === 'return') return setView($, 'main')
    return
  }
  if (view !== 'main' && (key === 'b' || key === 'return')) return setView($, 'main')
  if (pet?.gone && key === 'n') return newEgg($)
  switch (key) {
    case 'f':
      return doCare($, 'meal')
    case 's':
      return doCare($, 'snack')
    case 'p':
      return startGame($)
    case 'c':
      return doCare($, 'clean')
    case 'm':
      return doCare($, 'medicine')
    case 'l':
      return doCare($, 'lights')
    case 'd':
      return doCare($, 'scold')
    case 'i':
      return setView($, view === 'stats' ? 'main' : 'stats')
    case 'r':
      return setView($, view === 'history' ? 'main' : 'history')
    case 'h':
    case '?':
      return setView($, view === 'help' ? 'main' : 'help')
    default:
      return
  }
}

// ── /tama ───────────────────────────────────────────────────────────────────────────────────

async function runCommand($: Engine, args: string): Promise<void> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ').trim()
  const on = (v: string) => (v === 'on' || v === 'true' ? true : v === 'off' || v === 'false' ? false : null)
  switch (verb.toLowerCase()) {
    case '':
      if (await isPaneUp($)) {
        await $.ui.close({ id: PANE })
        $.ui.invalidate('ui.render')
        return
      }
      return openPane($, 'main')
    case 'open':
    case 'show':
      return openPane($)
    case 'close':
    case 'hide':
      await $.ui.close({ id: PANE })
      $.ui.invalidate('ui.render')
      return
    case 'feed':
    case 'meal':
    case 'eat':
      return doCare($, 'meal')
    case 'snack':
    case 'candy':
      return doCare($, 'snack')
    case 'clean':
    case 'flush':
      return doCare($, 'clean')
    case 'medicine':
    case 'med':
    case 'heal':
      return doCare($, 'medicine')
    case 'lights':
    case 'sleep':
    case 'wake':
      return doCare($, 'lights')
    case 'scold':
    case 'discipline':
      return doCare($, 'scold')
    case 'pat':
    case 'pet':
      return doCare($, 'pat')
    case 'play':
    case 'game':
      await startGame($)
      return (await read($, viewAtom)) === 'game' ? openPane($) : undefined
    case 'stats':
    case 'info':
      return openPane($, 'stats')
    case 'help':
    case '?':
      return openPane($, 'help')
    case 'history':
    case 'hall':
      await loadGraveyard($)
      return openPane($, 'history')
    case 'name':
    case 'rename':
      if (!arg) return openPane($, 'name')
      await change($, pet => ({ pet: rename(pet, arg), ok: true, say: `my name is ${rename(pet, arg).name}!` }))
      return
    case 'band':
      if (!BANDS.includes(arg as BandMode)) {
        $.ui.toast(`band: ${BANDS.join(', ')}`)
        return
      }
      await saveSettings($, { band: arg as BandMode })
      $.ui.toast(`band: ${arg}`)
      return
    case 'shell':
    case 'color':
      if (!COLORS.includes(arg as ShellColor)) {
        $.ui.toast(`shell: ${COLORS.join(', ')}`)
        return
      }
      await saveSettings($, { shell: arg as ShellColor })
      return
    case 'spinner':
    case 'sound': {
      const value = on(arg)
      const current = await read($, settingsAtom)
      const next = value ?? !current[verb === 'sound' ? 'sound' : 'spinner']
      await saveSettings($, verb === 'sound' ? { sound: next } : { spinner: next })
      $.ui.toast(`${verb}: ${next ? 'on' : 'off'}`)
      return
    }
    case 'mode':
      if (arg !== 'classic' && arg !== 'gentle') {
        $.ui.toast('mode: classic (it can leave if badly neglected) or gentle (it never does)')
        return
      }
      await saveSettings($, { mode: arg })
      $.ui.toast(`mode: ${arg}`)
      return
    case 'vacation': {
      const value = on(arg)
      const pet = await read($, petAtom)
      const going = value ?? pet?.vacation === null
      await change($, (p, now) => ({ pet: going ? startVacation(p, now) : endVacation(p, now), ok: true, say: going ? 'have a nice trip!' : 'welcome back!' }))
      $.ui.toast(going ? 'vacation: its clock is stopped until /tama vacation off' : 'vacation over: its clock runs again')
      return
    }
    case 'new':
      return newEgg($)
    case 'reset': {
      const pet = await read($, petAtom)
      let answer = 'Keep it'
      try {
        answer = await $.ui.ask(`Say goodbye to ${pet?.name ?? 'your pet'} and start a new egg?`, ['Keep it', 'Start over'])
      } catch {
        return
      }
      if (answer !== 'Start over') return
      await change($, (p, now) => ({ pet: { ...nextEgg(p, now), generation: p.generation }, ok: true, say: 'a new egg!' }))
      return
    }
    default:
      $.ui.toast(`no /tama ${verb}. /tama help lists them`)
  }
}

// ── drawing ─────────────────────────────────────────────────────────────────────────────────

type Ctx = {
  pet: Pet
  settings: Settings
  view: View
  game: Game | null
  reaction: Reaction | null
  speech: Speech | null
  working: boolean
  now: number
  graveyard: Memorial[]
}

async function context($: Engine, working?: boolean): Promise<Ctx | null> {
  const pet = await read($, petAtom)
  if (!pet) return null
  return {
    pet,
    settings: await read($, settingsAtom),
    view: await read($, viewAtom),
    game: await read($, gameAtom),
    reaction: await read($, reactionAtom),
    speech: await read($, speechAtom),
    working: working ?? (await read($, workingAtom)),
    now: await $.clock.now(),
    graveyard: await read($, graveAtom),
  }
}

function sceneOf(c: Ctx): SceneInput {
  const { pet, reaction } = c
  return {
    species: pet.species,
    seed: pet.id,
    asleep: pet.asleep,
    tucked: pet.tucked,
    sick: pet.sick > 0,
    bugs: pet.bugs,
    calling: pet.calling !== null && pet.calling !== 'tantrum',
    tantrum: pet.tantrum,
    sad: pet.happy < 25 && pet.species !== 'egg',
    working: c.working,
    gone: pet.gone !== null,
    reaction: reaction ? { kind: reaction.kind, id: reaction.id, ...(reaction.from ? { from: reaction.from } : {}) } : null,
    game: c.view === 'game' && c.game ? { answer: c.game.answer, guess: c.game.guess, round: c.game.round } : null,
  }
}

const reactionAge = (c: Ctx) => (c.reaction ? c.now - c.reaction.at : null)
const isReacting = (c: Ctx) => c.reaction !== null && c.now - c.reaction.at < REACTION_MS[c.reaction.kind]
const spoken = (c: Ctx) => (c.speech && c.now - c.speech.at < SPEECH_MS ? c.speech.text : null)

function icons(p: Pet) {
  return {
    food: p.hunger <= 25,
    light: p.asleep,
    game: p.happy <= 25,
    medicine: p.sick > 0,
    bath: p.bugs > 0,
    meter: false,
    discipline: p.tantrum,
    attention: p.calling !== null,
  }
}

type Action = { key: string; label: string; hotkey: string }

/** The buttons for a view: each one also answers its key on the clicked screen. */
function actionsOf(c: Ctx): Action[] {
  const { pet, view, game } = c
  if (view === 'game') {
    return game?.isOver
      ? [
          { key: 'p', label: 'again', hotkey: 'p' },
          { key: 'x', label: 'done', hotkey: 'x' },
        ]
      : [
          { key: 'left', label: '← left', hotkey: 'a' },
          { key: 'right', label: 'right →', hotkey: 'd' },
          { key: 'x', label: 'quit', hotkey: 'x' },
        ]
  }
  if (view !== 'main') return [{ key: 'b', label: 'back', hotkey: 'b' }]
  if (pet.gone) {
    return [
      { key: 'n', label: 'new egg', hotkey: 'n' },
      { key: 'r', label: 'history', hotkey: 'r' },
    ]
  }
  if (pet.species === 'egg') {
    return [
      { key: 'i', label: 'stats', hotkey: 'i' },
      { key: 'h', label: 'help', hotkey: 'h' },
    ]
  }
  return [
    { key: 'f', label: 'feed', hotkey: 'f' },
    { key: 's', label: 'snack', hotkey: 's' },
    { key: 'p', label: 'play', hotkey: 'p' },
    { key: 'c', label: 'clean', hotkey: 'c' },
    { key: 'm', label: 'medicine', hotkey: 'm' },
    { key: 'l', label: pet.asleep ? 'wake' : 'lights', hotkey: 'l' },
    { key: 'd', label: 'scold', hotkey: 'd' },
    { key: 'i', label: 'stats', hotkey: 'i' },
  ]
}

/** The lines beside the screen: meters while it lives, a memorial once it has gone. */
function infoLines(c: Ctx): { label: string; value: string; color?: string }[] {
  const { pet, now } = c
  if (pet.gone) {
    return [
      { label: 'lived', value: ageText(ageOf(pet, now)) },
      { label: 'watched', value: `${compact(pet.stats.toolCalls)} tool calls` },
      { label: 'saw', value: `${pet.stats.commits} commits` },
    ]
  }
  if (pet.species === 'egg') {
    return [
      { label: 'gen', value: `${pet.generation}` },
      { label: 'laid', value: `${ageText(now - pet.born)} ago` },
    ]
  }
  const lines: { label: string; value: string; color?: string }[] = [
    { label: 'food', value: meter(pet.hunger), color: hearts(pet.hunger) <= 1 ? 'red' : 'redBright' },
    { label: 'fun', value: meter(pet.happy), color: hearts(pet.happy) <= 1 ? 'red' : 'yellow' },
    { label: 'disc', value: bars(pet.discipline), color: 'cyan' },
    { label: 'age', value: `${ageText(ageOf(pet, now))} · gen ${pet.generation}` },
    { label: 'weight', value: `${pet.weight}g` },
  ]
  if (pet.bugs > 0) lines.push({ label: 'bugs', value: 'ж '.repeat(pet.bugs).trim(), color: 'green' })
  if (pet.sick > 0) lines.push({ label: 'sick', value: `needs ${pet.sick === 1 ? 'a dose' : '2 doses'}`, color: 'magenta' })
  if (pet.vacation !== null) lines.push({ label: 'away', value: 'on vacation', color: 'blue' })
  return lines
}

function statsLines(c: Ctx): [string, string][] {
  const { pet, now } = c
  const s = pet.stats
  const sp = species(pet.species)
  const lines: [string, string][] = [
    ['form', `${sp.name}: ${sp.blurb}`],
    ['next', nextGrowth(pet, now) ?? 'fully grown'],
    ['age', `${ageText(ageOf(pet, now))} · generation ${pet.generation}`],
    ['care', `${pet.mistakes} care mistake${pet.mistakes === 1 ? '' : 's'} · discipline ${Math.round(pet.discipline)}`],
    ['watched', `${compact(s.toolCalls)} tool calls · ${compact(s.turns)} turns · ${compact(s.tokens)} tokens`],
    ['work', `${s.edits} edits · ${s.searches} reads · ${s.shell} commands · ${s.agents} agents`],
    ['tests', `${s.tests} passed · ${s.testFails} failed`],
    ['git', `${s.commits} commits · ${s.pushes} pushes`],
    ['care', `${s.meals} meals · ${s.snacks} snacks · ${s.games} games (${s.wins} won) · ${s.cleans} cleans · ${s.meds} doses · ${s.pats} pats`],
  ]
  return lines
}

function historyLines(c: Ctx): string[] {
  if (c.graveyard.length === 0) return ['No pets have left yet. Long may it last.']
  return [...c.graveyard]
    .reverse()
    .slice(0, 12)
    .map(m => `gen ${m.generation} · ${m.name} the ${species(m.species).name} · lived ${ageText(m.gone - m.born)} · ${compact(m.toolCalls)} tool calls`)
}

// ── /tama's pane ────────────────────────────────────────────────────────────────────────────

function paneTerminal($: Engine, el: any, c: Ctx, cols: number, rows: number, docked: boolean) {
  const { Box, Text, Button, Client, Input } = el
  const shell = SHELLS[c.settings.shell] ?? SHELLS.coral
  const { pet } = c
  const sp = species(pet.species)
  // the screen doubles where there is room for it: 64×16 cells, else 32×8
  const scale: 1 | 2 = cols >= 72 && rows >= 26 ? 2 : 1
  const wide = cols >= (scale === 2 ? 68 : 36) + 30
  const lcd = (
    <Client
      key={`lcd:${scale}`}
      module="./lcd.tsx"
      width={32 * scale}
      height={8 * scale}
      props={{ input: sceneOf(c), mode: 'device', scale, age: reactionAge(c) ?? 999999, ink: LCD.ink, bg: LCD.bg }}
    />
  )
  const attention = pet.calling !== null && !pet.gone
  const device = (
    <Box flexDirection="column" borderStyle="round" borderColor={shell.base} paddingX={1} width={32 * scale + 4}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={shell.base}>
          {pet.name.toUpperCase()}
        </Text>
        <Text color={attention ? 'redBright' : shell.base} bold={attention}>
          {attention ? '! ' : ''}
          {pet.gone ? 'gone' : sp.name.toLowerCase()}
        </Text>
      </Box>
      {lcd}
    </Box>
  )

  let side: unknown
  if (c.view === 'stats') {
    side = (
      <Box flexDirection="column">
        <Text bold>{title(pet)}</Text>
        {statsLines(c).map(([k, v]) => (
          <Text wrap="wrap">
            <Text dimColor>{k.padEnd(8)}</Text>
            {v}
          </Text>
        ))}
      </Box>
    )
  } else if (c.view === 'help') {
    side = (
      <Box flexDirection="column">
        <Text bold>/tama</Text>
        {HELP.map(([k, v]) => (
          <Text wrap="wrap">
            <Text color={shell.base}>{k}</Text>
            <Text dimColor>{`  ${v}`}</Text>
          </Text>
        ))}
        <Text dimColor wrap="wrap">
          Click the screen to pat it; then its keys work there too. Esc gives the prompt back.
        </Text>
      </Box>
    )
  } else if (c.view === 'history') {
    side = (
      <Box flexDirection="column">
        <Text bold>Hall of fame</Text>
        {historyLines(c).map(line => (
          <Text dimColor wrap="wrap">
            {line}
          </Text>
        ))}
      </Box>
    )
  } else if (c.view === 'game' && c.game) {
    const g = c.game
    side = (
      <Box flexDirection="column">
        <Text bold>Left or right?</Text>
        <Text dimColor wrap="wrap">
          Guess which way {pet.name} will look. Win 3 of 5.
        </Text>
        <Text>
          {'round '}
          {Math.min(5, g.round + (g.isOver ? 0 : 1))}
          {'/5 · won '}
          {g.wins}
        </Text>
        {g.answer ? (
          <Text color={g.answer === g.guess ? 'greenBright' : 'red'}>{g.answer === g.guess ? `yes! it looked ${g.answer}` : `no, it looked ${g.answer}`}</Text>
        ) : null}
        {g.isOver ? <Text bold>{g.wins >= 3 ? `${pet.name} had a blast!` : `${pet.name} wants a rematch`}</Text> : null}
      </Box>
    )
  } else if (c.view === 'name' && Input) {
    side = (
      <Box flexDirection="column">
        <Text bold>A new name</Text>
        <Input
          key="name"
          label="Name"
          placeholder={pet.name}
          value=""
          submitLabel="rename"
          autoFocus
          onSubmit={async (value: string) => {
            if (value.trim()) await change($, p => ({ pet: rename(p, value), ok: true, say: `my name is ${rename(p, value).name}!` }))
            await setView($, 'main')
          }}
        />
      </Box>
    )
  } else {
    side = (
      <Box flexDirection="column">
        {infoLines(c).map(line => (
          <Text>
            <Text dimColor>{line.label.padEnd(7)}</Text>
            {line.color ? <Text color={line.color}>{line.value}</Text> : line.value}
          </Text>
        ))}
      </Box>
    )
  }

  const words = spoken(c)
  return (
    <Box flexDirection="column">
      <Box flexDirection={wide ? 'row' : 'column'} columnGap={2}>
        {device}
        {side}
      </Box>
      <Text wrap="truncate-end" color={words ? shell.base : undefined} dimColor={!words}>
        {words ? `“${words}”` : statusLine(pet)}
      </Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {actionsOf(c).map(a => (
          <Button key={`act:${a.key}`} label={a.label} hotkey={a.hotkey} plain onPress={() => press($, a.key)} />
        ))}
      </Box>
    </Box>
  )
}

function paneRemote($: Engine, el: any, c: Ctx, cols: number) {
  const { Box, Text, Button, Svg, Input } = el
  const { pet } = c
  const svg = deviceSvg({ input: sceneOf(c), rt: isReacting(c) ? reactionAge(c) : null, name: pet.name, shell: c.settings.shell, icons: icons(pet) })
  const words = spoken(c)
  const lines =
    c.view === 'stats'
      ? statsLines(c).map(([k, v]) => `${k}: ${v}`)
      : c.view === 'help'
        ? HELP.map(([k, v]) => `${k}: ${v}`)
        : c.view === 'history'
          ? historyLines(c)
          : c.view === 'game' && c.game
            ? [
                `Left or right? Round ${Math.min(5, c.game.round + (c.game.isOver ? 0 : 1))} of 5, won ${c.game.wins}.`,
                ...(c.game.answer ? [c.game.answer === c.game.guess ? `Yes! It looked ${c.game.answer}.` : `No, it looked ${c.game.answer}.`] : []),
              ]
            : infoLines(c).map(l => `${l.label}  ${l.value}`)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection={cols >= 60 ? 'row' : 'column'} columnGap={3} alignItems="flex-start">
        <Svg key="device" source={svg} alt={`${title(pet)}: ${statusLine(pet)}`} width={220} height={250} isInteractive />
        <Box flexDirection="column">
          <Text bold>{title(pet)}</Text>
          {lines.map(line => (
            <Text wrap="wrap">{line}</Text>
          ))}
          {c.view === 'name' && Input ? (
            <Input
              key="name"
              label="Name"
              placeholder={pet.name}
              value=""
              submitLabel="rename"
              autoFocus
              onSubmit={async (value: string) => {
                if (value.trim()) await change($, p => ({ pet: rename(p, value), ok: true }))
                await setView($, 'main')
              }}
            />
          ) : null}
        </Box>
      </Box>
      <Text dimColor={!words}>{words ? `“${words}”` : statusLine(pet)}</Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {actionsOf(c).map(a => (
          <Button key={`act:${a.key}`} label={a.label} hotkey={a.hotkey} onPress={() => press($, a.key)} />
        ))}
      </Box>
    </Box>
  )
}

// ── the band above the prompt ───────────────────────────────────────────────────────────────

function bandLine(el: any, c: Ctx) {
  const { Box, Text } = el
  const { pet } = c
  const shell = SHELLS[c.settings.shell] ?? SHELLS.coral
  const words = spoken(c)
  const alive = !pet.gone && pet.species !== 'egg'
  return (
    <Box flexDirection="row" columnGap={1}>
      <Text color={shell.base} bold>
        {face(pet)}
      </Text>
      <Text bold>{pet.name}</Text>
      {alive ? <Text color="redBright">{meter(pet.hunger)}</Text> : null}
      {alive ? <Text color="yellow">{meter(pet.happy)}</Text> : null}
      {alive && pet.bugs > 0 ? <Text color="green">{'ж'.repeat(pet.bugs)}</Text> : null}
      <Text dimColor={!words && pet.calling === null} color={pet.calling ? 'redBright' : undefined} wrap="truncate-end">
        {words ? `“${words}”` : statusLine(pet)}
      </Text>
    </Box>
  )
}

function bandLaneSide(el: any, c: Ctx) {
  const { Box, Text } = el
  const { pet } = c
  const shell = SHELLS[c.settings.shell] ?? SHELLS.coral
  const words = spoken(c)
  const alive = !pet.gone && pet.species !== 'egg'
  return (
    <Box flexDirection="column" width={30}>
      <Text wrap="truncate-end">
        <Text bold color={shell.base}>
          {pet.name}
        </Text>
        <Text dimColor>{` ${species(pet.species).name.toLowerCase()}`}</Text>
      </Text>
      {alive ? (
        <Text>
          <Text dimColor>{'food '}</Text>
          <Text color="redBright">{meter(pet.hunger)}</Text>
          <Text dimColor>{' fun '}</Text>
          <Text color="yellow">{meter(pet.happy)}</Text>
        </Text>
      ) : (
        <Text dimColor>{pet.gone ? 'gone to the cloud' : 'wobbling…'}</Text>
      )}
      <Text wrap="truncate-end" color={words ? shell.base : pet.calling ? 'redBright' : undefined} dimColor={!words && !pet.calling}>
        {words ? `“${words}”` : statusLine(pet)}
      </Text>
      <Text dimColor>{'/tama'}</Text>
    </Box>
  )
}

// ── the hooks ───────────────────────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await loadSettings($)
    await loadGraveyard($)
    const saved = await $.store.get('pet').catch(() => undefined)
    const isFirst = !isPet(saved)
    await change($, null)
    // a headless run (claude -p, the SDK) still feeds it from tool calls, but draws nothing
    if (e.isInteractive) {
      if (isFirst) $.ui.toast('A Tamagotchi egg appeared! Type /tama to see it', { timeoutMs: 8000 })
      // the pet's clock: every half minute, run its life forward (and see what other sessions did)
      $.clock.every(TICK_MS, () => {
        void change($, null)
      })
    }
    for (const name of ['tama', 'tamagotchi']) {
      await $.command
        .register({
          name,
          description: name === 'tama' ? 'Your Tamagotchi: open it, or feed, play, clean, medicine, lights, stats, help…' : 'Your Tamagotchi (same as /tama)',
          argumentHint: '[feed|snack|play|clean|medicine|lights|scold|stats|help|name|band|shell]',
          immediate: true,
        })
        .catch(err => $.ui.log(`cc-tamagotchi: /${name} not registered: ${err}`, { to: 'debug' }))
    }
    return r
  })

  // /clear, /resume and /branch reset $.state: put the pet back from the store
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadSettings($)
    await loadGraveyard($)
    await change($, null)
    return next(e)
  })

  on('command.run', { command: ['tama', 'tamagotchi'] }, async ($, e) => {
    await runCommand($, e.args)
    return {}
  })

  // Claude's work feeds it: every finished tool call, told apart by kind
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const shellCommand = (e as { command?: unknown }).command
    const kind = classify(e.tool, typeof shellCommand === 'string' ? shellCommand : undefined, 'deny' in r && r.deny !== undefined ? undefined : r.isError !== true)
    if (kind) await change($, (pet, now) => (pet.vacation !== null ? null : work(pet, kind.work, kind.isError, now)))
    return r
  })

  on('turn.start', async ($, e, next) => {
    await update($, workingAtom, () => true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      await update($, workingAtom, () => false)
      const tokens = e.usage?.output_tokens ?? 0
      await change($, (pet, now) => (pet.vacation !== null ? null : { pet: turnDone(pet, tokens, new Date(now).getHours(), now), ok: true }))
    }
    return r
  })

  // a prompt wakes a napping pet
  on('prompt.submit', async ($, e, next) => {
    await change($, (pet, now) => (pet.asleep && !pet.tucked ? { pet: { ...pet, asleep: false, lastActive: now }, ok: true, reaction: 'wake' } : null))
    return next(e)
  })

  // the screen in the terminal: a click pats, keys press the device's buttons
  on('ui.message', async ($, e, next) => {
    const data = e.data as { act?: unknown; key?: unknown } | null
    if (data?.act === 'pat') await doCare($, 'pat')
    else if (data?.act === 'key' && typeof data.key === 'string') await press($, data.key)
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE) $.ui.invalidate('ui.render')
    return r
  })

  on('ui.render', { component: 'Pane', requestId: 'tama' }, async ($, e) => {
    const c = await context($)
    const el = $.ui.resolve(e)
    if (!c) return el.Text({ children: ['waking up…'] })
    const cols = e.props.bodyColumns
    if (e.surface === 'terminal') {
      // docked, the pane has its body's rows; inline above the prompt, about what it asked for
      const rows = e.props.placement === 'dock' ? e.props.scroll.bodyRows : (e.viewport?.rows ?? 24) >= 60 ? 26 : 20
      return paneTerminal($, el, c, cols, rows, e.props.placement === 'dock')
    }
    return paneRemote($, el, c, cols)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await context($, e.props.isWorking)
    // the device is up: it says everything the band would
    if (!c || e.props.hasSurvey || c.settings.band === 'off' || (await isPaneUp($))) return next(e)
    const el: any = $.ui.resolve(e)
    const { Box, Client, Svg } = el
    const { pet } = c
    const lively = e.props.isWorking || pet.species === 'egg' || isReacting(c) || (c.speech !== null && c.now - c.speech.at < BAND_AFTER_MS)
    // auto and big: the strip while something is going on, else one line; on: the strip always
    const blocks = c.settings.band === 'big'
    const big = e.props.maxRows >= (blocks ? 10 : 6) && (c.settings.band === 'on' || ((c.settings.band === 'auto' || blocks) && lively))
    const shell = SHELLS[c.settings.shell] ?? SHELLS.coral
    let mine: unknown
    if (!big) {
      mine = bandLine(el, c)
    } else if (e.surface === 'terminal') {
      // dots: 16 pixels in 4 rows; blocks: 16 pixels in 8 rows, each pixel a whole cell wide
      const laneCols = Math.max(16, Math.min(blocks ? 96 : 90, e.props.bodyColumns - 34))
      mine = (
        <Box flexDirection="row" columnGap={2}>
          <Client
            key={blocks ? 'lane:blocks' : 'lane'}
            module="./lcd.tsx"
            width={laneCols}
            height={blocks ? 8 : 4}
            props={{ input: sceneOf(c), mode: blocks ? 'strip' : 'lane', age: reactionAge(c) ?? 999999, ink: shell.base }}
          />
          {bandLaneSide(el, c)}
        </Box>
      )
    } else if (Svg) {
      const svg = laneSvg(sceneOf(c), isReacting(c) ? reactionAge(c) : null, shell.base, 80)
      mine = (
        <Box flexDirection="row" columnGap={2} alignItems="center">
          <Svg key="lane" source={svg} alt={statusLine(pet)} width={240} height={48} isInteractive />
          {bandLaneSide(el, c)}
        </Box>
      )
    } else {
      mine = bandLine(el, c)
    }
    return (
      <Box flexDirection="column">
        {mine}
        {await next(e)}
      </Box>
    )
  })

  // its face rides beside the spinner while Claude works
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const settings = await read($, settingsAtom)
    const pet = await read($, petAtom)
    if (!settings.spinner || !pet || pet.species === 'egg' || pet.gone) return next(e)
    return next({ ...e, props: { ...e.props, suffix: `${e.props.suffix} ${face(pet)}` } })
  })

  // when it needs something and Claude is idle, the hint line under the prompt says so
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.props.isWorking || e.props.isDraft) return next(e)
    const pet = await read($, petAtom)
    if (!pet?.calling || pet.gone) return next(e)
    return next({ ...e, props: { ...e.props, tail: `${pet.name} ${NEED_TEXT[pet.calling]} · /tama` } })
  })
}
