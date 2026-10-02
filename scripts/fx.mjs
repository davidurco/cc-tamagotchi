// Writes fx/beep.wav: three short piezo beeps, the sound a pocket pet makes when it wants you.
// 8-bit mono, 22050 Hz, a square wave. `node scripts/fx.mjs` regenerates it.
import fs from 'node:fs'

const RATE = 22050
const samples = []
const tone = (hz, ms, gain = 0.22) => {
  const n = Math.round((RATE * ms) / 1000)
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / 60, (n - i) / 60)
    samples.push(128 + Math.round((Math.sin((2 * Math.PI * hz * i) / RATE) >= 0 ? 1 : -1) * 127 * gain * fade))
  }
}
const rest = ms => tone(0, ms, 0)
for (let i = 0; i < 3; i++) {
  tone(2900, 70)
  rest(60)
}

const data = Buffer.from(samples)
const head = Buffer.alloc(44)
head.write('RIFF', 0)
head.writeUInt32LE(36 + data.length, 4)
head.write('WAVE', 8)
head.write('fmt ', 12)
head.writeUInt32LE(16, 16)
head.writeUInt16LE(1, 20)
head.writeUInt16LE(1, 22)
head.writeUInt32LE(RATE, 24)
head.writeUInt32LE(RATE, 28)
head.writeUInt16LE(1, 32)
head.writeUInt16LE(8, 34)
head.write('data', 36)
head.writeUInt32LE(data.length, 40)
fs.mkdirSync(new URL('../fx/', import.meta.url), { recursive: true })
fs.writeFileSync(new URL('../fx/beep.wav', import.meta.url), Buffer.concat([head, data]))
console.log('fx/beep.wav', 44 + data.length, 'bytes')
