// SPDX-License-Identifier: GPL-3.0-or-later
// Work directly on a unit running a Modwerk base, without a reboot: read its
// state, try a runtime module, then keep or roll it back. Speaks the USB bench
// protocol, so a real unit needs the bridge (Octatrack only so far):
//
//   ~/.cache/modwerk-upstream/venv/bin/python -B sdk/machines/octatrack/elekloader/usb_bridge.py /tmp/modwerk-ot.sock &
//   npm run device -- status
//   npm run device -- try MODULE.mwrm [--seconds 5] [--accept]
//   npm run device -- remove [MODULE.mwrm] [--accept]   # that file's module, else module 0
//   npm run device -- lifecycle
//   npm run device -- boot BUILD_DIR       # RAM boot: build_core.py's output, no flashing
//   npm run device -- key PLAY | FUNC+PLAY | 0x27   # development bases (build_core.py --dev)
//   npm run device -- screen [--png FILE]           # the display, in block characters or as a 4x PNG
//   npm run device -- state                         # stopped / playing, recording
//   npm run device -- loader                        # the DSP loader's counters (--dsp-loader bases)
//   npm run device -- report                        # its full report (dsp.c modwerk_dsp_report, version 9: 63 words; miss0-2 the first refused packet (dsp_receiver.asm))
//   npm run device -- probe 0|1                     # one no-op loader packet to a DSP core
//   npm run device -- meter 0|1                     # the DSP load meter's last 1024-frame window (core 0's idle iterations)
//   npm run device -- enc A+3 | LEVEL-1 | fader 128 # encoders A-F and LEVEL, the crossfader
//
// --emulator drives ot_emu's USB bench socket instead (it enumerates the device
// first; ot_emu takes one connection, so one command per emulator run).
// Each command is one whole transaction. A trial is rolled back unless --accept
// is given; Ctrl-C rolls back early. If this process dies mid-trial, unplug USB:
// the base rolls back any module that was not accepted.
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { sha } from '../vendor/elekloader/kit/src/bytes.ts'
import { UploadSession } from '../src/engine/elekloader/upload-session.ts'
import { findVendorInterface, UsbVendorTransport } from '../src/engine/elekloader/upload-usb.ts'
import { diagnostics, removal, runLifecycle } from '../src/dev/octatrack-usb-lifecycle.ts'
import { Bench, device, enumerate } from './usb-bench.mjs'

const { values, positionals: [command, file] } = parseArgs({ allowPositionals: true, options: {
  socket: { type: 'string', default: '/tmp/modwerk-ot.sock' },
  seconds: { type: 'string', default: '5' },
  accept: { type: 'boolean', default: false },
  emulator: { type: 'boolean', default: false },
  png: { type: 'string' },
} })
const seconds = Number(values.seconds)
if (!['status', 'try', 'remove', 'lifecycle', 'boot', 'key', 'screen', 'state', 'enc', 'fader', 'loader', 'report', 'probe', 'meter'].includes(command) || (['try', 'boot', 'key', 'enc', 'fader', 'probe', 'meter'].includes(command) && !file) ||
  (['status', 'lifecycle', 'screen', 'state', 'loader', 'report'].includes(command) && file) ||
  !Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
  console.error('Usage: device.mjs status | try MODULE.mwrm [--seconds 1-3600] [--accept] | remove [MODULE.mwrm] [--accept] | lifecycle | boot BUILD_DIR | key NAME[+NAME] | screen | state | loader | report | probe 0|1 | meter 0|1 | enc A+3 | fader 0-255 [--socket PATH] [--emulator]')
  process.exit(2)
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const bench = new Bench(values.socket)
await bench.ready()
const unit = device(bench), index = findVendorInterface(await enumerate(bench, !values.emulator))
const transport = new UsbVendorTransport(unit, index, { pollMs: 5 })
const identity = await transport.identify()
// DIAG is the Octatrack base's own request; other bases may not answer it.
const diag = () => diagnostics(unit, index).catch(() => undefined)

// Development bases (build_core.py --dev, dev.c): keys as the panel reports them, and the composed screen.
const KEYS = { DOWN: 0x20, RIGHT: 0x21, SRC: 0x22, AMP: 0x23, LFO: 0x24, FX1: 0x25, FX2: 0x26, STOP: 0x27, PLAY: 0x28,
  REC: 0x29, CUE: 0x2a, FUNC: 0x2d, PATTERN: 0x2e, BANK: 0x2f, YES: 0x31, NO: 0x32, UP: 0x33, LEFT: 0x34, MIDI: 0x35,
  PROJ: 0x1c, PART: 0x1d, AED: 0x1e, ARR: 0x1f, LEVEL: 0x3e,
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['TRIG' + (i + 1), i])),
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['T' + (i + 1), 0x10 + i])),
  ...Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F'].map((e, i) => ['PUSH' + e, 0x38 + i])) }
async function devIn(request, value, length) {
  const reply = await unit.controlTransferIn({ requestType: 'vendor', recipient: 'interface', request, value, index }, length)
  if (reply.status !== 'ok' || reply.data?.byteLength !== length) throw new Error('This base does not answer development requests: build it with --dev.')
  return new Uint8Array(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength)
}
/** FUNC+PLAY: hold every key but the last, tap the last, release the held ones. */
async function keys(spec) {
  const codes = spec.split('+').map(name => KEYS[name.toUpperCase()] ?? Number(name))
  if (codes.some(code => !Number.isInteger(code) || code < 0 || code > 63)) throw new Error('Unknown key in ' + spec + ': ' + Object.keys(KEYS).join(' '))
  for (const code of codes) { await devIn(5, code | 0x100, 1); await wait(code === codes.at(-1) ? 80 : 30) }
  for (const code of codes.reverse()) { await devIn(5, code, 1); await wait(30) }
}
async function screen() {
  const frame = (await devIn(7, 0, 1028)).subarray(4)
  const on = (x, y) => (frame[x * 8 + ((63 - y) >> 3)] >> (7 - ((63 - y) & 7))) & 1
  if (values.png) { // 512x256 greyscale, each pixel 4x4
    const rows = Buffer.concat(Array.from({ length: 256 }, (_, y) =>
      Buffer.from([0, ...Array.from({ length: 512 }, (_, x) => on(x >> 2, y >> 2) ? 255 : 24)])))
    const chunk = (type, data) => { const t = Buffer.from(type), l = Buffer.alloc(4), c = Buffer.alloc(4)
      l.writeUInt32BE(data.length); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]) }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(512, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 0
    writeFileSync(values.png, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]))
    return console.log('screen saved to ' + values.png)
  }
  for (let y = 0; y < 64; y += 2)
    console.log(Array.from({ length: 128 }, (_, x) => ' ▄▀█'[on(x, y) * 2 + on(x, y + 1)]).join(''))
}
const state = s => `${s.phase}, generation ${s.generation}, active ${s.active?.slice(0, 16) ?? 'unknown'}…`
console.log(`${identity.model}, base ${identity.base.slice(0, 16)}…`)

const interrupt = new AbortController()
process.once('SIGINT', () => { console.log('interrupted: rolling back'); process.exitCode = 130; interrupt.abort() })

/** While the unit plays, the base presses STOP and refuses with `unsafe`; retry for 3 s as the site does. */
async function stopping(step) {
  for (const start = Date.now(); ; await wait(200)) {
    try { return await step() } catch (error) { if (error.status?.result !== 'unsafe' || Date.now() - start > 3000) throw error }
  }
}

/** Stage, publish and run `pkg` in a trial for `seconds`, then accept or roll back. */
async function trial(session, pkg) {
  await stopping(() => session.stage(pkg, { signal: interrupt.signal })); await session.activate(); await session.startTrial()
  console.log(`trial: ${pkg.sha256.slice(0, 16)}… running`)
  for (let second = 1; second <= seconds && !interrupt.signal.aborted; second++) {
    await wait(1000)
    const d = await diag()
    if (d) console.log(`  ${second}s: ticks ${d.ticks}, value 0x${d.value.toString(16)}, slot ${d.active ? 'running' : 'empty'}, refusals ${d.refusals}`)
  }
  await stopping(() => session.holdTrial())
  if (values.accept && !interrupt.signal.aborted) { await session.accept(); console.log('accepted') }
  else { await session.rollback(); console.log('rolled back' + (values.accept ? '' : ' (pass --accept to keep it)')) }
  return session.leaveUploadMode()
}

/** After a RAM boot: wait until the unit has gone away and come back far enough to answer HELLO. */
let backBench
async function rebooted() {
  let gone = false
  for (const start = Date.now(); Date.now() - start < 60000; await wait(500)) {
    const again = backBench = new Bench(values.socket)
    try {
      await again.ready()
      const d = device(again), i = findVendorInterface(await enumerate(again, true))
      const t = new UsbVendorTransport(d, i, { pollMs: 5 }), base = (await t.identify()).base
      if (gone) return { base, session: await UploadSession.connect(t, base, { timeoutMs: 60000 }) } // the engine refuses until it runs
      again.socket.end()
    } catch { gone = true; again.socket.end() }
  }
  throw new Error('The unit did not come back within 60 s; a power cycle boots the flashed base.')
}

try {
  if (command === 'key') { await keys(file); process.exit(0) }
  if (command === 'screen') { await screen(); process.exit(0) }
  if (command === 'enc') {
    const [, name, delta] = /^([A-F]|LEVEL)([+-]\d+)$/i.exec(file) ?? []
    const encoder = 'ABCDEF'.indexOf(name?.toUpperCase()) >= 0 ? 'ABCDEF'.indexOf(name.toUpperCase()) : name?.toUpperCase() === 'LEVEL' ? 6 : -1
    if (encoder < 0 || !Number(delta) || Math.abs(delta) > 127) throw new Error('Use enc A+3, enc F-1 or enc LEVEL+2.')
    await devIn(8, 0x30 | encoder | (Number(delta) & 0xff) << 8, 1); process.exit(0)
  }
  if (command === 'fader') {
    const position = Number(file)
    if (!Number.isInteger(position) || position < 0 || position > 255) throw new Error('Use fader 0-255.')
    await devIn(8, 0x40 | position << 8, 1); process.exit(0)
  }
  if (command === 'loader') {
    const bytes = await devIn(9, 0, 60), view = new DataView(bytes.buffer, bytes.byteOffset, 60)
    const names = ['frames', 'accepted0', 'accepted1', 'rejected0', 'rejected1', 'errors', 'probe', 'stage', 'job0', 'job1',
      'pool0', 'pool1', 'refused', 'missing', 'used']
    console.log(Object.fromEntries(names.map((name, i) => [name, name.startsWith('job') ? view.getInt32(4 * i) : view.getUint32(4 * i)])))
    process.exit(0)
  }
  if (command === 'report') {
    const names = ['version', 'frames', 'phase', 'job0', 'job1', 'hostFlags', 'accepted0', 'accepted1', 'rejected0', 'rejected1',
      'errors', 'stalls', 'drained', 'residencyEnabled', 'manager', 'watchTicks', 'probesSent', 'probesAnswered', 'probesTimedOut',
      'selRequested', 'selCompleted', 'selRefused', 'selCancelled', 'resCommits', 'resFailures', 'resRollbacks',
      'words0', 'words1', 'earlyVisits', 'parked', 'reinit', 'missing', 'used', 'dry',
      'frameState', 'frameBusy', 'intcIprl', 'intcImrl', 'eportPinFlagSelect', 'edmaIntErr', 'csr0csr1', 'edmaEs',
      'edmaErrors', 'edmaEsSeen', 'missCore', 'missBits', 'missCheck', 'miss0', 'miss1', 'miss2', 'pin7', 'straddles', 'core1Sent',
      'meterCore', 'meterBits', 'meterSerial', 'idleLeast', 'idleMost', 'idleSum', 'missed', 'mapGeneration', 'mapRead', 'mapWritten']
    const bytes = await devIn(11, 0, 4 * names.length), view = new DataView(bytes.buffer, bytes.byteOffset, 4 * names.length)
    const hex = new Set(['hostFlags', 'manager', 'used', 'dry', 'intcIprl', 'intcImrl', 'eportPinFlagSelect', 'edmaIntErr', 'csr0csr1', 'edmaEs', 'edmaEsSeen', 'missCheck', 'miss0', 'miss1', 'miss2'])
    console.log(Object.fromEntries(names.map((name, i) => [name, ['job0', 'job1', 'missCore', 'meterCore'].includes(name) ? view.getInt32(4 * i)
      : hex.has(name) ? '0x' + view.getUint32(4 * i).toString(16) : view.getUint32(4 * i)])))
    process.exit(0)
  }
  if (command === 'meter') { // dsp_receiver.asm's load meter, read back a bit a frame (63 report words, version 9)
    if (!['0', '1'].includes(file)) throw new Error('Use meter 0 or meter 1.')
    if (!(await devIn(13, Number(file), 1))[0]) throw new Error('A meter read is already waiting.')
    for (const until = Date.now() + 15000; Date.now() < until; await new Promise(r => setTimeout(r, 200))) {
      const bytes = await devIn(11, 0, 4 * 63), view = new DataView(bytes.buffer, bytes.byteOffset, 4 * 63), w = i => view.getUint32(4 * i)
      if (view.getInt32(4 * 53) !== Number(file) || w(54) !== 120) continue
      console.log({ core: Number(file), window: w(55), idleLeast: w(56), idleMost: w(57), idleMean: +(w(58) / 1024).toFixed(1), missed: w(59) })
      process.exit(0)
    }
    throw new Error('The meter was not read within 15 s (the loader busy?).')
  }
  if (command === 'probe') {
    if (!['0', '1'].includes(file)) throw new Error('Use probe 0 or probe 1.')
    console.log('probe core', file, (await devIn(12, Number(file), 1))[0] ? 'sent' : 'not sent (busy or not idle)'); process.exit(0)
  }
  if (command === 'state') { const [stopped, recording] = await devIn(6, 0, 2); console.log(stopped ? 'stopped' : 'playing', recording ? '(recording)' : ''); process.exit(0) }
  // A whole OS image takes the unit (and far longer the emulator) a while to hash.
  const session = await UploadSession.connect(transport, identity.base, { timeoutMs: command === 'boot' ? 60000 : 10000 })
  if (command === 'status') console.log(state(session.status), '\nDIAG', await diag() ?? 'not answered')
  if (command === 'lifecycle') await runLifecycle(unit, index, console.log)
  if (command === 'remove') {
    // An ABI 4 file names its module (sdk/runtime/loader/README.md); ABI 3 modules are module 0.
    const view = file ? new DataView(new Uint8Array(readFileSync(file)).buffer) : undefined
    if (view && (view.byteLength < 32 || view.getUint32(0) !== 0x4d57524d)) throw new Error(file + ' is not a runtime module.')
    console.log(state(await trial(session, removal(identity.base, view?.getUint16(4) >= 4 ? view.getUint32(28) : undefined))))
  }
  if (command === 'try') {
    const data = new Uint8Array(readFileSync(file))
    // shortcut: runtime module files do not name their base yet, so any file is offered to the connected base,
    // whose loader validates it; bind the base once the hook ABI defines module files.
    console.log(state(await trial(session, { base: identity.base, data, sha256: sha(data) })))
  }
  if (command === 'boot') {
    const image = new Uint8Array(readFileSync(join(file, 'MAIN.raw')))
    const expected = JSON.parse(readFileSync(join(file, 'proofs.json'), 'utf8')).configurationHash
    if (image.length < 4 || new DataView(image.buffer, image.byteOffset).getUint32(0) !== 0x4fefffe4)
      throw new Error(join(file, 'MAIN.raw') + ' is not an OS image.')
    const arm = async (s, base) => {
      let shown = 0
      await s.stage({ base, data: image, sha256: sha(image) }, { signal: interrupt.signal, progress: (done, total) => {
        if (Math.floor(10 * done / total) > shown) console.log(`  staged ${10 * (shown = Math.floor(10 * done / total))}%`)
      } })
      await s.activate() // the base arms the boot and resets half a second later
      console.log(`armed: the unit restarts into ${expected.slice(0, 16)}… from RAM; a power cycle returns to the flashed base`)
    }
    await arm(session, identity.base)
    if (values.emulator) await wait(3000) // ot_emu stops when the client hangs up; let the reset run first
    else {
      bench.socket.end()
      let back = await rebooted()
      // Only the flashed base's gate reads the mailbox, at its own address: armed from a RAM-booted base,
      // the boot falls back to the flashed one, which can then arm it properly.
      if (back.base !== expected && back.base !== identity.base) {
        console.log(`came back on the flashed base ${back.base.slice(0, 16)}…: arming again from it`)
        await arm(back.session, back.base)
        backBench.socket.end()
        back = await rebooted()
      }
      if (back.base !== expected) throw new Error(`The unit came back on base ${back.base.slice(0, 16)}…, not the one sent; a power cycle boots the flashed base.`)
      console.log(`booted: base ${expected.slice(0, 16)}…`)
    }
  }
} catch (error) {
  console.error(error.message, error.cause?.message ?? '')
  console.error('If a module was left in trial, unplug USB: the base rolls back anything not accepted.')
  process.exitCode = 1
} finally { bench.socket.end(); backBench?.socket.end() }
