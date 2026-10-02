// Records a tmux pane running Claude Code as an animated GIF (and stills): every `every` ms it
// captures the pane with its colors, crops it, and draws it with ./ansi.mjs. Not part of the mod.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import gifenc from 'gifenc'
import { draw, parse, svgOf } from './ansi.mjs'

const { applyPalette, GIFEncoder, quantize } = gifenc
const here = path.dirname(fileURLToPath(import.meta.url))
export const FONTS = ['DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf', 'DejaVuSans.ttf'].map(f => path.join(here, 'node_modules/dejavu-fonts-ttf/ttf', f))
const sleep = ms => new Promise(r => setTimeout(r, ms))

export const tmux = (...args) => execFileSync('tmux', args).toString()
export const keys = (target, ...k) => tmux('send-keys', '-t', target, ...k)
export const type = (target, text) => tmux('send-keys', '-t', target, '-l', text)

export function capture(target, crop) {
  const columns = Number(tmux('display', '-p', '-t', target, '#{pane_width}').trim())
  let lines = tmux('capture-pane', '-e', '-p', '-t', target).replace(/\n$/, '').split('\n')
  if (crop?.rows) lines = lines.slice(crop.rows[0], crop.rows[1])
  let rows = parse(lines.join('\n'), columns)
  if (crop?.cols) rows = rows.map(r => r.slice(crop.cols[0], crop.cols[1]))
  return rows
}

const render = (rows, pad = 14) => {
  const { markup, width, height } = draw(rows)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width + pad * 2}" height="${height + pad * 2}"><rect width="100%" height="100%" rx="10" fill="#16171b"/><g transform="translate(${pad} ${pad})">${markup}</g></svg>`
}
const raster = svg => new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans Mono' } }).render()

/** A recording: call `frame()` as often as you like, then `gif(path)`. */
export function recorder(target, crop, every = 140) {
  const frames = []
  let last = ''
  return {
    async take(ms) {
      for (let t = 0; t < ms; t += every) {
        const rows = capture(target, crop)
        const k = JSON.stringify(rows)
        if (k === last) frames[frames.length - 1].delay += every
        else frames.push({ rows, delay: every })
        last = k
        await sleep(every)
      }
    },
    still(out) {
      fs.writeFileSync(out, raster(render(capture(target, crop))).asPng())
      console.log(out)
    },
    gif(out, colors = 96) {
      const gif = GIFEncoder()
      let palette = null
      for (const f of frames) {
        const img = raster(render(f.rows))
        palette ??= quantize(img.pixels, colors)
        gif.writeFrame(applyPalette(img.pixels, palette), img.width, img.height, { palette, delay: f.delay })
      }
      gif.finish()
      fs.writeFileSync(out, gif.bytes())
      console.log(out, frames.length, 'frames', Math.round(gif.bytes().length / 1024), 'KB')
    },
  }
}

/**
 * The whole pane as a PNG in a window frame. `scrub` blanks the transcript side of rows whose
 * text matches it (an account notice that has no place in a README).
 */
export function window(target, out, title, scrub) {
  const columns = Number(tmux('display', '-p', '-t', target, '#{pane_width}').trim())
  let text = tmux('capture-pane', '-e', '-p', '-t', target)
  if (scrub) {
    text = text
      .split('\n')
      .map(line => {
        const plain = line.replace(/\x1b\[[0-9;]*m/g, '')
        if (!scrub.test(plain)) return line
        const bar = plain.indexOf('│')
        return ' '.repeat(bar < 0 ? plain.length : bar) + (bar < 0 ? '' : line.slice(line.indexOf('│')))
      })
      .join('\n')
  }
  fs.writeFileSync(out, raster(svgOf(text, { columns, title })).asPng())
  console.log(out)
}

export { sleep }
