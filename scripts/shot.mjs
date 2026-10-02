#!/usr/bin/env node
// node scripts/shot.mjs <tmux-target> <out.png> [title] [--rows a:b]
// Captures a tmux pane running Claude Code with its colors and writes it as a PNG.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { svgOf } from './ansi.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const FONTS = ['DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf', 'DejaVuSans.ttf'].map(f => path.join(here, 'node_modules/dejavu-fonts-ttf/ttf', f))

const [target, out, title = 'claude', ...rest] = process.argv.slice(2)
if (!target || !out) {
  console.error('usage: node scripts/shot.mjs <tmux-target> <out.png> [title] [--rows a:b]')
  process.exit(1)
}
const columns = Number(execFileSync('tmux', ['display', '-p', '-t', target, '#{pane_width}']).toString().trim())
let text = execFileSync('tmux', ['capture-pane', '-e', '-p', '-t', target]).toString()
const rowsArg = rest.indexOf('--rows')
if (rowsArg >= 0) {
  const [a, b] = rest[rowsArg + 1].split(':').map(Number)
  text = text.split('\n').slice(a, b).join('\n')
}
const svg = svgOf(text, { columns, title })
if (out.endsWith('.svg')) fs.writeFileSync(out, svg)
else fs.writeFileSync(out, new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans Mono' }, fitTo: { mode: 'zoom', value: 1 } }).render().asPng())
console.log(out)
