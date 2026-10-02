#!/usr/bin/env node
// Draws the README's pictures from the mod's own code: the device animated as a GIF, the six
// shells, the evolution chart. `cd scripts && npm install && node assets.mjs` writes them to docs/.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import gifenc from 'gifenc'
import { blank, draw, spriteWidth } from '../hooks/pet/bitmap.ts'
import { REACTION_MS } from '../hooks/pet/scene.ts'
import { SPECIES } from '../hooks/pet/species.ts'
import { deviceSvg, LCD, SHELLS } from '../hooks/pet/svg.ts'

const { applyPalette, GIFEncoder, quantize } = gifenc
const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.join(here, '../docs')
fs.mkdirSync(docs, { recursive: true })
const FONTS = ['DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf', 'DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map(f => path.join(here, 'node_modules/dejavu-fonts-ttf/ttf', f))
const raster = (svg, zoom = 1) => new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' }, fitTo: { mode: 'zoom', value: zoom } }).render()
const png = (svg, out, zoom = 1) => {
  fs.writeFileSync(path.join(docs, out), raster(svg, zoom).asPng())
  console.log('docs/' + out)
}
const inner = svg => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')

const BASE = { seed: 'readme', asleep: false, tucked: false, sick: false, bugs: 0, calling: false, tantrum: false, sad: false, working: false, gone: false, reaction: null, game: null }
const ICONS = { food: false, light: false, game: false, medicine: false, bath: false, meter: false, discipline: false, attention: false }

// ── the hero: one device, animated ──────────────────────────────────────────────────────────

function hero() {
  const STEP = 130
  // what plays: a stroll while Claude works, a meal, a commit party, a bug and a clean
  const acts = [
    { ms: 3000, input: { ...BASE, species: 'refactopus', working: true } },
    { ms: REACTION_MS.eat, input: { ...BASE, species: 'refactopus', reaction: { kind: 'eat', id: 1 } }, react: true },
    { ms: 1500, input: { ...BASE, species: 'refactopus', bugs: 2, working: true }, icons: { bath: true } },
    { ms: REACTION_MS.clean, input: { ...BASE, species: 'refactopus', bugs: 2, reaction: { kind: 'clean', id: 2 } }, react: true },
    { ms: REACTION_MS.party, input: { ...BASE, species: 'refactopus', reaction: { kind: 'party', id: 3 } }, react: true },
    { ms: 1800, input: { ...BASE, species: 'refactopus', working: true } },
  ]
  const zoom = 1.5
  const gif = GIFEncoder()
  let palette = null
  let clock = 0
  const frames = []
  for (const act of acts) {
    for (let t = 0; t < act.ms; t += STEP) {
      const svg = deviceSvg({ input: act.input, rt: null, name: 'Mochi', shell: 'coral', icons: { ...ICONS, ...(act.icons ?? {}) }, at: { t: clock + t, rt: act.react ? t : null } })
      const page = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="276" viewBox="-20 -13 260 276"><rect x="-20" y="-13" width="260" height="276" fill="#f3efe7"/>${inner(svg)}</svg>`
      // a frame equal to the one before only lengthens it
      if (frames.length && frames[frames.length - 1].page === page) frames[frames.length - 1].delay += STEP
      else frames.push({ page, delay: STEP })
    }
    clock += act.ms
  }
  for (const f of frames) {
    const img = raster(f.page, zoom)
    palette ??= quantize(img.pixels, 48)
    gif.writeFrame(applyPalette(img.pixels, palette), img.width, img.height, { palette, delay: f.delay })
  }
  gif.finish()
  fs.writeFileSync(path.join(docs, 'device.gif'), gif.bytes())
  console.log('docs/device.gif', Math.round(gif.bytes().length / 1024), 'KB')
}

// ── the six shells ──────────────────────────────────────────────────────────────────────────

function shells() {
  const lineup = [
    ['coral', 'refactopus', 'Mochi'],
    ['mint', 'assertoise', 'Tofu'],
    ['grape', 'owlgorithm', 'Nori'],
    ['sky', 'shellby', 'Pico'],
    ['banana', 'commitmunk', 'Biscuit'],
    ['ink', 'unicorn', 'Gizmo'],
  ]
  const W = 230
  let body = ''
  lineup.forEach(([shell, species, name], i) => {
    const svg = deviceSvg({ input: { ...BASE, species, bugs: i === 3 ? 1 : 0, working: i % 2 === 0 }, rt: null, name, shell, uid: `s${i}`, icons: { ...ICONS, attention: i === 3, bath: i === 3 }, at: { t: 600 + i * 900, rt: null } })
    body += `<g transform="translate(${i * W + 5} 10)">${inner(svg)}</g>`
    body += `<text x="${i * W + 115}" y="282" text-anchor="middle" font-family="DejaVu Sans Mono" font-size="13" fill="#6b6f76">${shell}</text>`
  })
  png(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * 6 + 10}" height="300"><rect width="100%" height="100%" fill="#ffffff" fill-opacity="0"/>${body}</svg>`, 'shells.png', 1.5)
}

// ── the evolution chart ─────────────────────────────────────────────────────────────────────

function tile(id, x, y, size = 4) {
  const s = SPECIES[id].sprite
  const w = spriteWidth(s)
  const b = blank(w, s.length)
  draw(b, s, 0, 0, {})
  const box = 18 * size
  let d = ''
  for (let py = 0; py < b.h; py++) for (let px = 0; px < b.w; px++) if (b.px[py * b.w + px]) d += `M${px} ${py}h1v1h-1z`
  const ox = (18 - w) / 2
  const oy = 18 - s.length - 1
  return `<rect x="${x}" y="${y}" width="${box}" height="${box}" rx="${size * 2}" fill="${LCD.bg}"/><path transform="translate(${x + ox * size} ${y + oy * size}) scale(${size})" d="${d}" fill="${LCD.ink}"/>`
}

function card(id, x, y, w) {
  const s = SPECIES[id]
  const words = (text, max) => {
    const lines = ['']
    for (const word of text.split(' ')) {
      if ((lines[lines.length - 1] + ' ' + word).trim().length > max) lines.push(word)
      else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + word).trim()
    }
    return lines
  }
  const how = words(s.how, 22)
    .map((line, i) => `<text x="${x + w / 2}" y="${y + 110 + i * 15}" text-anchor="middle" font-family="DejaVu Sans" font-size="11.5" fill="#7a7f87">${line}</text>`)
    .join('')
  return `${tile(id, x + (w - 72) / 2, y)}<text x="${x + w / 2}" y="${y + 92}" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="14" fill="#30333a">${s.name}</text>${how}`
}

function evolution() {
  const W = 1000
  const accent = SHELLS.coral.dark
  const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="#c9ccd1" stroke-width="2" fill="none" marker-end="url(#a)"/>`
  let body = `<defs><marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L8 4L0 8z" fill="#c9ccd1"/></marker></defs>`
  // the line of youth, then the two teens it can become
  ;[['egg', 20], ['bit', 200], ['nibble', 380], ['bytey', 600], ['glitchy', 810]].forEach(([id, x]) => (body += card(id, x, 30, 150)))
  body += arrow(172, 66, 208, 66) + arrow(352, 66, 388, 66) + arrow(532, 66, 610, 66)
  body += `<text x="782" y="72" text-anchor="middle" font-family="DejaVu Sans" font-size="13" font-style="italic" fill="#9a9ea5">or</text>`
  body += `<text x="${W / 2}" y="205" text-anchor="middle" font-family="DejaVu Sans" font-size="13" fill="${accent}" font-weight="700">THEN, AFTER 3 DAYS AND 800 TOOL CALLS, ONE OF EIGHT ADULTS</text>`
  const adults = ['assertoise', 'refactopus', 'shellby', 'grepossum', 'commitmunk', 'owlgorithm', 'spaghetto', 'unicorn']
  adults.forEach((id, i) => (body += card(id, 20 + (i % 4) * 245, 225 + Math.floor(i / 4) * 175, 225)))
  png(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="590"><rect width="100%" height="100%" rx="16" fill="#fbfaf7"/>${body}</svg>`, 'evolution.png', 1.5)
}

// ── the card a link to the repository unfurls into ─────────────────────────────────────────

function social() {
  const device = (shell, species, name, uid, t, extra = {}) =>
    inner(deviceSvg({ input: { ...BASE, species, working: true, ...extra }, rt: null, name, shell, uid, icons: ICONS, at: { t, rt: null } }))
  const body = [
    `<rect width="1280" height="640" fill="#f6f1e8"/>`,
    `<circle cx="330" cy="330" r="270" fill="#efe6d6"/>`,
    `<g transform="translate(36 236) scale(1.25)" opacity="0.95">${device('mint', 'assertoise', 'Tofu', 'm', 1900)}</g>`,
    `<g transform="translate(350 236) scale(1.25)" opacity="0.95">${device('grape', 'owlgorithm', 'Nori', 'g', 3100)}</g>`,
    `<g transform="translate(150 70) scale(1.8)">${device('coral', 'refactopus', 'Mochi', 'c', 600, { reaction: { kind: 'cheer', id: 1 } })}</g>`,
    `<text x="700" y="250" font-family="DejaVu Sans" font-weight="700" font-size="64" fill="#2c2f36">cc-tamagotchi</text>`,
    `<text x="702" y="310" font-family="DejaVu Sans" font-size="28" fill="#555a63">A Tamagotchi that lives</text>`,
    `<text x="702" y="348" font-family="DejaVu Sans" font-size="28" fill="#555a63">inside Claude Code.</text>`,
    `<text x="702" y="418" font-family="DejaVu Sans" font-size="21" fill="#7a7f87">It hatches, eats the code Claude writes,</text>`,
    `<text x="702" y="448" font-family="DejaVu Sans" font-size="21" fill="#7a7f87">leaves bugs behind, and grows into</text>`,
    `<text x="702" y="478" font-family="DejaVu Sans" font-size="21" fill="#7a7f87">one of eight adults.</text>`,
    `<rect x="700" y="516" width="186" height="40" rx="20" fill="${SHELLS.coral.base}"/>`,
    `<text x="793" y="542" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="17" fill="#ffffff">Claude Code mod</text>`,
    `<rect x="900" y="516" width="150" height="40" rx="20" fill="${LCD.bg}"/>`,
    `<text x="975" y="542" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="17" fill="${LCD.ink}">zero tokens</text>`,
  ].join('')
  png(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640">${body}</svg>`, 'social.png', 1)
}

hero()
shells()
evolution()
social()
