import { describe, expect, mock, test } from 'claude-code/testing'
import type { Pet } from '../types'
import { newPet } from '../hooks/pet/life.ts'
import { ALL_SURFACES, BAND, PANE, SURFACES, T0 } from './fixtures.ts'

// Boots the mod as a session does: a store in memory, a clock the test moves, and Claude Code's
// answers to what the mod asks of it.
function world(on: any, entries: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: T0 })
  const saved = new Map<string, unknown>(Object.entries(entries))
  const toasts: string[] = []
  const opened: string[] = []
  on('store.get', ($: unknown, e: { key: string }) => ({ value: saved.get(e.key) }))
  on('store.set', ($: unknown, e: { key: string; value: unknown }) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', ($: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  const up = new Set<string>()
  on('ui.open', ($: unknown, e: { id: string }) => {
    opened.push(e.id)
    up.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($: unknown, e: { id: string }) => {
    up.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...up].map(id => ({ id, title: id, isShown: true, isFocused: true, isPlaced: true })) }))
  on('audio.play', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('classic.SessionStart', () => ({}))
  on('turn.start', ($: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($: unknown, e: { text: string }) => ({ text: e.text }))
  // what the mod passed on for Claude Code to draw, by component
  const passed = new Map<string, Record<string, unknown>>()
  on('ui.render', ($: unknown, e: { component: string; props: Record<string, unknown> }) => {
    passed.set(e.component, e.props)
    return { type: 'Text', props: {}, children: ['drawn by Claude Code'] }
  })
  on('tool.call', ($: unknown, e: { tool: string; command?: string }) => (e.command?.includes('fail') ? { result: 'FAIL', isError: true } : { result: 'ok' }))
  const pet = () => saved.get('pet') as Pet
  return { clock, saved, toasts, opened, pet, passed }
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

/** `/tama <args>`, typed at the prompt of a 120-column terminal. */
const tama = ($: any, args = '') =>
  $.command.run({ command: 'tama', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

const grown = (over: Partial<Pet> = {}): Pet => ({ ...newPet(T0, { id: 'seed01', name: 'Mochi' }), species: 'refactopus', hatchedAt: T0 - 4 * 86_400_000, evolvedAt: T0, ...over })

describe('register', () => {
  test('a first session lays an egg and says so', async ($, on) => {
    const w = world(on)
    await start($)
    expect(w.pet().species).toBe('egg')
    expect(w.toasts[0]).toContain('egg appeared')
  })

  test("Claude's first tool call after a minute hatches the egg", async ($, on) => {
    const w = world(on)
    await start($)
    await w.clock.advance(61_000)
    await $.tool.call({ tool: 'Read', file_path: 'README.md' })
    // the pet follows a tool call in the background: let that finish
    await w.clock.settle()
    expect(w.pet().species).toBe('bit')
    expect(w.toasts.some(t => t.includes('hatched'))).toBe(true)
  })

  test('tool calls feed the stats; a failing test run leaves a bug', async ($, on) => {
    const w = world(on, { pet: grown() })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'bun test --fail' })
    await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: pet"' })
    await w.clock.settle()
    const pet = w.pet()
    expect(pet.stats).toMatchObject({ edits: 1, testFails: 1, commits: 1, toolCalls: 3 })
    expect(pet.bugs).toBe(1)
  })

  test('/tama opens the device, /tama again closes it', async ($, on) => {
    const w = world(on, { pet: grown() })
    await start($)
    await tama($, '')
    expect(w.opened).toEqual(['tama'])
    const answer = await tama($, '')
    // nothing printed: the model never reads the pet
    expect(answer).toEqual({})
    await tama($, '')
    expect(w.opened).toEqual(['tama', 'tama'])
  })

  test('/tama feed, clean and medicine look after it', async ($, on) => {
    const w = world(on, { pet: grown({ hunger: 30, bugs: 2, sick: 1 }) })
    await start($)
    await tama($, 'feed')
    await tama($, 'clean')
    await tama($, 'medicine')
    const pet = w.pet()
    expect(pet.hunger).toBeGreaterThan(50)
    expect(pet.bugs).toBe(0)
    expect(pet.sick).toBe(0)
  })

  test('settings persist: band, shell, mode', async ($, on) => {
    const w = world(on, { pet: grown() })
    await start($)
    await tama($, 'band line')
    await tama($, 'shell mint')
    await tama($, 'mode gentle')
    expect(w.saved.get('settings')).toMatchObject({ band: 'line', shell: 'mint', mode: 'gentle' })
  })

  test('the device draws on every surface, and its buttons work', async ($, on) => {
    const w = world(on, { pet: grown({ hunger: 30 }) })
    await start($)
    for (const surface of ALL_SURFACES) {
      const ui = await $.ui.mount({ ...PANE(), surface })
      expect(await ui.find({ key: 'act:f' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ ...PANE(), surface: 'terminal' })
    await ui.press({ key: 'act:f' })
    expect(w.pet().stats.meals).toBe(1)
    await ui.press({ key: 'act:i' })
    expect(await ui.find({ type: 'Text', text: /tool calls/ })).toBeDefined()
  })

  test('the desktop gets the egg-shaped device as an animated SVG', async ($, on) => {
    world(on, { pet: grown() })
    await start($)
    const ui = await $.ui.mount({ ...PANE(), surface: 'desktop' })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg).toBeDefined()
  })

  test('the left-or-right game plays five rounds', async ($, on) => {
    const w = world(on, { pet: grown({ happy: 20 }) })
    await start($)
    const ui = await $.ui.mount({ ...PANE(), surface: 'terminal' })
    await ui.press({ key: 'act:p' })
    for (let i = 0; i < 5; i++) await ui.press({ key: 'act:left' })
    expect(w.pet().stats.games).toBe(1)
    expect(await ui.find({ key: 'act:p' })).toBeDefined()
  })

  test('the screen in the terminal: a click pats it', async ($, on) => {
    const w = world(on, { pet: grown({ happy: 50 }) })
    await start($)
    const ui = await $.ui.mount({ ...PANE(60), surface: 'terminal' })
    await ui.advance(500)
    await ui.pointer({ type: 'down', x: 4, y: 2, button: 'left' })
    expect(w.pet().stats.pats).toBe(1)
    const drawn = await ui.drawn({ in: 'lcd:1' })
    expect(drawn).toMatchObject({ type: 'Box' })
  })

  test('the band: one line while idle, the strip while Claude works', async ($, on) => {
    world(on, { pet: grown() })
    await start($)
    for (const surface of SURFACES) {
      const idle = await $.ui.mount({ ...BAND(false), surface })
      expect(await idle.find({ type: 'Text', text: 'Mochi' })).toBeDefined()
      await idle.unmount()
      const busy = await $.ui.mount({ ...BAND(true), surface })
      expect(await busy.find({ type: surface === 'terminal' ? 'Client' : 'Svg' })).toBeDefined()
      await busy.unmount()
    }
  })

  test('growing up is the moment: the edit that grows it does not replace the animation', async ($, on) => {
    const w = world(on, { pet: grown({ species: 'bit', hatchedAt: T0 - 2 * 3_600_000, stats: { ...grown().stats, toolCalls: 39 } }) })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b' })
    await w.clock.settle()
    expect(w.pet().species).toBe('nibble')
    expect(w.toasts.some(t => t.includes('grew into a Nibble'))).toBe(true)
    const ui = await $.ui.mount({ ...PANE(60), surface: 'terminal' })
    const lcd = await ui.find({ type: 'Client' })
    expect((lcd?.props as { props: { input: { reaction: { kind: string; from?: string } } } }).props.input.reaction).toMatchObject({ kind: 'evolve', from: 'bit' })
  })

  test("settings another session changed hold here too: gentle keeps a neglected pet", async ($, on) => {
    const w = world(on, { pet: grown({ hunger: 0, happy: 0, neglect: 700, lastActive: T0 + 99 * 3_600_000 }) })
    await start($)
    // another session switches to gentle after this one started
    w.saved.set('settings', { band: 'auto', spinner: true, sound: false, mode: 'gentle', shell: 'coral' })
    await w.clock.advance(60 * 60_000)
    expect(w.pet().gone).toBeNull()
    await tama($, 'Sound on')
    expect(w.saved.get('settings')).toMatchObject({ mode: 'gentle', sound: true, spinner: true })
  })

  test('a pet that leaves joins the hall of fame the store already has', async ($, on) => {
    const earlier = { name: 'Tofu', species: 'glitchy', generation: 1, born: T0 - 9e8, gone: T0 - 5e8, toolCalls: 10, commits: 1 }
    const w = world(on, { pet: grown({ hunger: 0, happy: 0, neglect: 719, lastActive: T0 + 99 * 3_600_000 }) })
    await start($)
    w.saved.set('graveyard', [earlier])
    await w.clock.advance(2 * 60_000)
    expect(w.pet().gone).not.toBeNull()
    expect((w.saved.get('graveyard') as unknown[]).length).toBe(2)
  })

  test('a gone pet leaves a memorial and a new egg on request', async ($, on) => {
    const w = world(on, { pet: grown({ gone: { at: T0, cause: 'neglect' } }) })
    await start($)
    await tama($, 'new')
    expect(w.pet().species).toBe('egg')
    expect(w.pet().generation).toBe(2)
  })
})

describe('time', () => {
  test('hours later it is hungry, and the hint line under the prompt says so', { timeoutMs: 60_000 }, async ($, on) => {
    const w = world(on, { pet: grown({ lastActive: T0 + 99 * 3_600_000 }) })
    await start($)
    await w.clock.advance(4 * 3_600_000 + 60_000)
    expect(w.pet().hunger).toBe(0)
    expect(w.pet().calling).toBe('hungry')
    const hint = await $.ui.mount({ plugin: 'cc-tamagotchi', component: 'PromptHint', surface: 'terminal', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } })
    await hint.drawn()
    expect(w.passed.get('PromptHint')?.tail).toBe('Mochi is hungry · /tama')
  })

  test('its face rides beside the spinner', async ($, on) => {
    const w = world(on, { pet: grown() })
    await start($)
    const spinner = await $.ui.mount({ plugin: 'cc-tamagotchi', component: 'Spinner', surface: 'terminal', props: { word: 'Baking', message: null, suffix: '…', mode: 'responding' } })
    await spinner.drawn()
    expect(w.passed.get('Spinner')?.suffix).toBe('… (◕ω◕)')
  })
})

describe('drawing', () => {
  const STATES: Record<string, Partial<Pet>> = {
    egg: { species: 'egg', hatchedAt: null },
    baby: { species: 'bit' },
    sick: { sick: 2, bugs: 4, hunger: 0, happy: 0, calling: 'sick' },
    asleep: { asleep: true, tucked: true },
    tantrum: { tantrum: true, calling: 'tantrum' },
    gone: { gone: { at: T0, cause: 'neglect' } },
    vacation: { vacation: T0 },
  }
  const VIEWS = ['main', 'stats', 'help', 'history', 'name', 'game'] as const

  for (const [name, over] of Object.entries(STATES)) {
    test(`${name}: every view draws on every surface, docked and inline`, { timeoutMs: 60_000 }, async ($, on) => {
      const graveyard = [{ name: 'Tofu', species: 'unicorn', generation: 1, born: T0 - 9e8, gone: T0, toolCalls: 4000, commits: 90 }]
      world(on, { pet: grown(over), graveyard })
      await start($)
      for (const view of VIEWS) {
        for (const surface of ALL_SURFACES) {
          for (const pane of [PANE(), PANE(50, 'dock', 40), PANE(140, 'dock', 50)]) {
            const where = `${name}/${view}/${surface}/${pane.props.placement}/${pane.viewport.columns}`
            const ui = await $.ui.mount({ ...pane, surface }).catch((err: Error) => {
              throw new Error(`${where}: ${err.message}`)
            })
            const key = view === 'game' ? 'act:p' : view === 'stats' ? 'act:i' : view === 'help' ? 'act:h' : view === 'history' ? 'act:r' : null
            if (key && (await ui.find({ key }))) await ui.press({ key })
            await ui.drawn().catch((err: Error) => {
              throw new Error(`${where}: ${err.message}`)
            })
            for (const back of ['act:b', 'act:x']) if (await ui.find({ key: back })) await ui.press({ key: back })
            await ui.unmount()
          }
        }
      }
      for (const surface of ALL_SURFACES) {
        for (const working of [false, true]) {
          const ui = await $.ui.mount({ ...BAND(working), surface }).catch((err: Error) => {
            throw new Error(`band ${name}/${surface}/${working}: ${err.message}`)
          })
          await ui.drawn()
          await ui.unmount()
        }
      }
    })
  }
})
