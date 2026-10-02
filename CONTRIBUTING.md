# Contributing

Thanks for wanting to make the pet better. New creatures, sprites, animations, games and bug
fixes are all welcome.

## The loop

You need Claude Code v2.1.287 or later. Nothing else: no Node, no build step.

```bash
git clone https://github.com/davidurco/cc-tamagotchi
cd cc-tamagotchi
claude --plugin-dir .            # the mod loads, and reloads each time you save
```

Type `/tama`. Every save reloads the hooks module; the pet itself lives in Claude Code's store and
survives the reload. A mod loaded with `--plugin-dir` keeps its own store, so experiments never
touch the pet of an installed copy.

Before you open a pull request:

```bash
claude plugin validate ./.claude-plugin/plugin.json
claude plugin test .
```

To type-check, load the folder once with `--plugin-dir` (Claude Code writes the API's types into
`.claude-plugin/types/`), then run `npx -p typescript tsc -p .`.

## How it fits together

| File | What it is |
| --- | --- |
| `hooks/register.tsx` | The hooks module: every event the mod handles, `/tama`, the store, and all the drawing |
| `hooks/lcd.tsx` | The terminal's screen: a `Client` module that animates on the drawing thread |
| `hooks/pet/life.ts` | The pet's life as pure functions: `tick` runs time forward, `care` is what you do, `work` is what Claude does |
| `hooks/pet/species.ts` | Every creature: name, sprite, blurb, how it is reached |
| `hooks/pet/sprites.ts` | The pixel art |
| `hooks/pet/scene.ts` | What the screen shows at a moment, as a display list; every animation lives here |
| `hooks/pet/svg.ts` | The desktop app's device and strip, animated with SMIL |
| `hooks/pet/paint.ts` | Half blocks and braille for the terminal |
| `types/index.d.ts` | The `$.state` contract |

Two rules keep it honest:

- **Nothing reaches the model.** Commands return `{}`; feedback goes to toasts, the band and the
  pane. A change that adds tokens to the conversation needs a very good reason.
- **The simulation is deterministic.** Every random roll in `life.ts` goes through `roll(pet.id,
  minute, what)`, so every session on a machine reaches the same pet. Don't use `Math.random()`
  there.

## Adding a creature

1. **Draw it** in `hooks/pet/sprites.ts`: 16×16 at most, one string per row, standing on its last
   row and facing right.

   | Character | Pixel |
   | --- | --- |
   | `#` | always on |
   | `.` | off |
   | `E` | an eye: on while open; a closed eye keeps only its lowest row, so draw eyes two rows tall |
   | `M` | the mouth: on only while it is open (eating, cheering) |

2. **Look at it.** `cd scripts && npm install && node assets.mjs` redraws the evolution chart in
   `docs/evolution.png` from the sprites, so you can see it at size.
3. **Add it** to `SPECIES` in `hooks/pet/species.ts` and to `SpeciesId` in `types/index.d.ts`.
4. **Decide how it is reached** in `adultFor` (`hooks/pet/life.ts`), and add a line for it to the
   adult test in `tests/life.test.ts`.
5. **Add it to the README's** tables.

## Pictures

Everything in `docs/` is drawn from the mod's own code:

- `node scripts/assets.mjs`: the device GIF, the six shells, the evolution chart.
- `node scripts/demo.mjs`: films a real Claude Code session in tmux (a demo pet, `/tama`, feeding,
  the band while Claude works). It spends one small model turn.

## Reporting a bug

Open an issue with your Claude Code version (`claude --version`), where you run it (terminal,
desktop app, which terminal), and what `/tama stats` says. The debug log (`claude --debug`) has a
line for every hook that failed.
