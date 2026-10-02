/* @jsx h */
import type { ClientSurface } from 'claude-code'
import { key } from './pet/bitmap.ts'
import { bigBlocks, braille, halfBlocks } from './pet/paint.ts'
import { rasterize, REACTION_MS, scene, type SceneInput } from './pet/scene.ts'

// The pet's screen in the terminal: a surface module the hooks module mounts with <Client>. It runs
// on the drawing thread with a frame clock of its own, so the pet walks, blinks and plays its
// animations without the hooks module redrawing anything. A click pats the pet; once clicked, the
// keys of the device's buttons reach the hooks module through `post`.
//
// Never name a local `h` here: every JSX tag compiles to a call of `h`.

export type LcdProps = {
  input: SceneInput
  /**
   * `device`: the 32×16 screen, pixels as half blocks (or doubled). `lane`: a strip as wide as the
   * region, in braille dots, 4 rows. `strip`: the same strip in half blocks, 8 rows.
   */
  mode: 'device' | 'lane' | 'strip'
  scale?: 1 | 2
  /** How long ago the current reaction began, as the hooks module drew it. */
  age?: number
  ink: string
  bg?: string
}

type State = { rows: string[]; frame: string }

const TICK = 110

// per instance: the props it was last drawn with, its clock and the reaction it is playing
type Live = { props: LcdProps; t: number; seen: number; startedAt: number }
const lives = new WeakMap<object, Live>()

function render(live: Live, columns: number): { rows: string[]; frame: string } {
  const { input, mode } = live.props
  const playing = input.reaction && input.reaction.id === live.seen ? live.t - live.startedAt : null
  const rt = playing !== null && input.reaction && playing < REACTION_MS[input.reaction.kind] ? playing : null
  const w = mode === 'lane' ? Math.max(24, columns * 2) : mode === 'strip' ? Math.max(24, columns) : 32
  const bitmap = rasterize(scene(input, live.t, rt, w, 16), w, 16)
  const rows = mode === 'lane' ? braille(bitmap) : mode === 'device' && live.props.scale === 2 ? bigBlocks(bitmap) : halfBlocks(bitmap)
  return { rows, frame: key(bitmap) }
}

export default function Lcd(props: LcdProps, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements
  let live = lives.get(surface)

  if (!live) {
    // a reaction already playing when the screen mounts plays on from where it is
    const age = props.age ?? Infinity
    live = { props, t: 0, seen: props.input.reaction?.id ?? -1, startedAt: -age }
    lives.set(surface, live)
    const first = live
    surface.every(TICK, () => {
      first.t += TICK
      const next = render(first, surface.columns)
      if (next.frame !== surface.state?.frame) surface.setState(next)
    })
    surface.onPointer(ev => {
      if (ev.type === 'down') surface.post({ act: 'pat' })
    })
    surface.onKey(ev => {
      if (!ev.ctrl && !ev.meta) surface.post({ act: 'key', key: ev.key })
    })
  }

  // new props: a new reaction starts now, on this screen's clock
  live.props = props
  const id = props.input.reaction?.id ?? -1
  if (id !== live.seen) {
    live.seen = id
    live.startedAt = live.t - Math.min(props.age ?? 0, 400)
  }

  // drawn from the live props every call; the clock's setState only says a new frame is due
  const drawn = render(live, surface.columns || 48)
  return (
    <Box flexDirection="column">
      {drawn.rows.map(row =>
        props.bg ? (
          <Text color={props.ink} backgroundColor={props.bg}>
            {row}
          </Text>
        ) : (
          <Text color={props.ink}>{row}</Text>
        ),
      )}
    </Box>
  )
}
