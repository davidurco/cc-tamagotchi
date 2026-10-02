#!/usr/bin/env node
// Films the README's terminal pictures: starts Claude Code in tmux with this folder as a
// --plugin-dir mod and a grown-up demo pet in its store, then drives /tama and records it.
// Spends one tiny model turn (for the band while Claude works). Not part of the mod.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { keys, recorder, sleep, tmux, type, window } from './record.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const docs = path.join(root, 'docs')
const S = 'tama-demo'
const COLS = 140
const ROWS = 38
const DAY = 86_400_000
const now = Date.now()

// a --plugin-dir mod keeps its own store, so the demo never touches an installed pet
const storeDir = path.join(os.homedir(), '.claude/plugins/store')
const store = fs.readdirSync(storeDir).find(f => f.startsWith('cc-tamagotchi_inline-'))
if (!store) throw new Error('load the mod once with claude --plugin-dir . first')
const storePath = path.join(storeDir, store)
const backup = fs.readFileSync(storePath, 'utf8')

const stats = { toolCalls: 1834, edits: 612, tests: 88, testFails: 21, commits: 47, pushes: 19, shell: 402, searches: 655, agents: 12, errors: 30, turns: 214, nightTurns: 31, tokens: 1_912_000, meals: 31, snacks: 12, games: 9, wins: 6, cleans: 14, meds: 2, pats: 40, scolds: 3 }
const pet = {
  v: 1, id: 'demo7f3a', name: 'Mochi', species: 'refactopus', generation: 2,
  born: now - 4.3 * DAY, hatchedAt: now - 4.3 * DAY + 90_000, evolvedAt: now - 1.2 * DAY, at: now,
  hunger: 45, happy: 70, discipline: 50, weight: 27, bugs: 2, sick: 0, asleep: false, tucked: false,
  lastActive: now, lastMeal: null, lastPat: 0, tantrum: false, calling: null, callWait: 0, callingCounted: false,
  mistakes: 2, neglect: 0, vacation: null, gone: null, rev: 1, stats,
}
const graveyard = [{ name: 'Tofu', species: 'glitchy', generation: 1, born: now - 9 * DAY, gone: now - 4.4 * DAY, toolCalls: 911, commits: 12 }]
fs.writeFileSync(storePath, JSON.stringify({ pet, graveyard, settings: { band: 'auto', spinner: true, sound: false, mode: 'classic', shell: 'coral' } }))

try {
  try {
    tmux('kill-session', '-t', S)
  } catch {}
  // Claude Code draws 256 colors when it sees tmux; hidden, it draws true color like a modern terminal
  const env = `env -i HOME=${os.homedir()} PATH=${process.env.PATH} LANG=C.UTF-8 TERM=xterm-256color COLORTERM=truecolor`
  tmux('new-session', '-d', '-s', S, '-x', String(COLS), '-y', String(ROWS), '-c', root, `${env} claude --plugin-dir ${root}`)
  tmux('set', '-t', S, 'status', 'off')
  await sleep(9000)

  // something in the transcript first, as in a session in use
  type(S, 'List the files in hooks/pet with ls, then reply in one short sentence.')
  await sleep(1500)
  keys(S, 'C-m')
  await sleep(14000)

  // the pane: docked beside the transcript
  type(S, '/tama')
  await sleep(800)
  keys(S, 'C-m')
  await sleep(2500)
  const paneCols = [COLS - 75, COLS]
  const pane = recorder(S, { cols: paneCols, rows: [0, 30] })
  await pane.take(2600)
  keys(S, 'f')
  await pane.take(2700)
  keys(S, 'c')
  await pane.take(2100)
  keys(S, 'p')
  await pane.take(700)
  keys(S, 'a')
  await pane.take(1200)
  keys(S, 'd')
  await pane.take(1200)
  keys(S, 'x')
  await pane.take(400)
  keys(S, 's')
  await pane.take(2600)
  window(S, path.join(docs, 'terminal.png'), 'claude — cc-tamagotchi', /\/passes|Share Claude Code|usage credits/)
  keys(S, 'i')
  await sleep(700)
  pane.still(path.join(docs, 'stats.png'))
  keys(S, 'b')
  await pane.take(800)
  pane.gif(path.join(docs, 'pane.gif'))

  // the band while Claude works, and its face beside the spinner
  keys(S, 'Escape')
  await sleep(400)
  type(S, '/tama')
  await sleep(800)
  keys(S, 'C-m')
  await sleep(1500)
  type(S, 'Run the bash command: sleep 9 && echo ok, then reply with just: ok')
  await sleep(1500)
  keys(S, 'C-m')
  // wait until Claude is working; a submit the prompt swallowed gets another Enter
  for (let i = 0; i < 20 && !/esc to interrupt/.test(tmux('capture-pane', '-p', '-t', S)); i++) {
    await sleep(500)
    if (i === 6) keys(S, 'C-m')
  }
  await sleep(3500)
  const band = recorder(S, { rows: [ROWS - 12, ROWS - 3] })
  await band.take(4200)
  band.gif(path.join(docs, 'band.gif'))
  band.still(path.join(docs, 'band.png'))
} finally {
  try {
    tmux('kill-session', '-t', S)
  } catch {}
  fs.writeFileSync(storePath, backup)
}
