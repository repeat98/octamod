// SPDX-License-Identifier: GPL-3.0-or-later
// DSP effects loaded on demand in the emulator (base built with build_core.py --dsp-loader):
// install the pilot module (E-Verb) over USB, then pick it on tracks through the stock FX2
// selector, as the panel would (dsp.c's test pick, which a USB test command will call),
// and check what each DSP core runs. Three steps, because
// ot_emu writes its memory dumps when the client hangs up:
//
//   ARGS=$(node scripts/verify-octatrack-dsp-loader.mjs dumps BUILD OUT)
//   ot_emu --image BUILD/MAIN.raw --card CARD --set SET --project PROJECT --load-ms 20000 --frame --dsp \
//     --usb-host SOCK --usb-hold-ms 600000 $ARGS > OUT/log.txt &      # docker run --shm-size=128m
//   node scripts/verify-octatrack-dsp-loader.mjs drive SOCK BUILD SCENARIO PACKAGE
//   node scripts/verify-octatrack-dsp-loader.mjs check BUILD OUT SCENARIO
//
// Scenarios: pick (T1 and T5, one per core), remove (refused while T1 runs it, then freed),
// cycles (a package declaring the most a module may, 491: T1 admitted, T2 refused on the same core),
// missing (T1's FX2 names E-Verb, as a saved project would, before it is installed: dry and
// reported, then restored by installing it), restore (install only, for
// sdk/machines/octatrack/elekloader/old_projects.py), probe (one PROBE packet to each core,
// no module: answered on a full or --dsp-probe B base, timed out on --dsp-probe A), stock (no module: the project's
// stock effects load from boot, PLATE REV and DARK REV picked on T1 and T5, each bound into its core's arena), meter
// (the load meter's last window read back; the emulator's timing, so the plumbing only), beside (the module on T1
// and T5, FX2 where it has a row, FX1 on T5 when it has both, then PLATE REV on T2 and DARK REV on T6: every effect
// each core runs is bound in its arena, the module word for word).
// SCENARIO:MODULE names the module by its catalogue id (src/engine/assets/dsp-packages.json); E-Verb by default.
// The card needs a project whose Part 1 has no module effect on T1, T2, T5 or T6.
// Emulator evidence only: executed instructions, no hardware timing or audio.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha } from '../vendor/elekloader/kit/src/bytes.ts'
import { UploadSession } from '../src/engine/elekloader/upload-session.ts'
import { findVendorInterface, UsbVendorTransport } from '../src/engine/elekloader/upload-usb.ts'
import { diagnostics, removal } from '../src/dev/octatrack-usb-lifecycle.ts'
import { Bench, device, enumerate } from './usb-bench.mjs'

const [mode, ...args] = process.argv.slice(2)
const LIVE_FX = 0x80000ec4
const COUNTERS = { dl_residency_words: 8, dl_pool_base: 8, dl_selection_requested: 4, dl_selection_completed: 4,
  dl_selection_refused: 4, dl_errors: 4, dl_modal_shown: 4, dl_parked: 4, dl_reinit: 4, modwerk_dsp_missing: 4,
  modwerk_dsp_probes_ok: 4, modwerk_dsp_probes_failed: 4, dl_frames: 4, modwerk_dsp_meter_core: 4, modwerk_dsp_meter_bits: 4,
  modwerk_dsp_meter: 20 }
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const build = dir => ({ proofs: json(join(dir, 'proofs.json')), symbols: json(join(dir, 'symbols.json')) })
const [scenario, module = 'everb'] = (args[2] ?? '').split(':')
const pkg = json(new URL('../src/engine/assets/dsp-packages.json', import.meta.url)).packages.find(p => p.id === module)
const EFFECT = pkg?.fxId
// The module's slot (0 FX1, 1 FX2) and chooser row: FX2 where it has a row, or FX1 first.
const place = (proofs, fx1First) => {
  const rows = [proofs.configuration.fx1.indexOf(pkg.key), proofs.configuration.fx2.indexOf(pkg.key)]
  const slot = fx1First ? (rows[0] > 0 ? 0 : 1) : (rows[1] > 0 ? 1 : 0)
  return [slot, rows[slot]]
}

if (mode === 'dumps') {
  const [dir, out] = args, { proofs, symbols } = build(dir), layout = proofs.dspLoader
  const dumps = [...Object.entries(COUNTERS).map(([name, n]) => `0x${symbols[name].toString(16)},${n}=${out}/${name}.bin`),
    `0x${LIVE_FX.toString(16)},16=${out}/ids.bin`]
  console.log(`--mem-dump ${dumps.join(';')} --dsp-peek 0:X:215,64;1:X:215,64;0:P:${layout.A.table.slice(2)},${parseInt(layout.A.tableWords, 16)};1:P:${layout.B.table.slice(2)},${parseInt(layout.B.tableWords, 16)}`)
} else if (mode === 'drive') {
  const [socket, dir, , file] = args, { proofs, symbols } = build(dir)
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const bench = new Bench(socket, { timeoutMs: 600000 }); await bench.ready()
  const index = findVendorInterface(await enumerate(bench, false))
  const transport = new UsbVendorTransport(device(bench), index, { pollMs: 5 })
  const base = (await transport.identify()).base
  const session = await UploadSession.connect(transport, base, { timeoutMs: 30000 })
  // The unit's own time: the emulator runs far slower than the wall clock under --dsp.
  const settle = async ticks => {
    const start = (await diagnostics(device(bench), index)).ticks
    while ((await diagnostics(device(bench), index)).ticks - start < ticks) await wait(200)
  }
  const call = async (address, ...values) => Number((await bench.command(`call 0x${address.toString(16)} ${values.join(' ')}`.trim()))[1])
  const keep = async data => {
    await session.stage({ base, data, sha256: sha(data) }); await session.activate(); await session.startTrial()
    await session.holdTrial(); await session.accept(); await session.leaveUploadMode()
  }
  const pick = async (track, slot, chooserRow) => {
    const [, queued] = await bench.command(`call 0x${symbols.modwerk_dsp_pick.toString(16)} ${slot} ${track} ${chooserRow}`)
    assert.equal(Number(queued), 1, 'the base queues the pick')
    await settle(300)
    console.log(`picked FX${slot + 1} row ${chooserRow} on track ${track + 1}`)
  }
  if (scenario === 'meter') { // the load meter's last window, read back through PEEK
    await settle(120)
    assert.equal(await call(symbols.modwerk_dsp_meter_read, 0), 1, 'the base starts the read')
    await settle(300); bench.socket.end(); process.exit(0)
  }
  if (scenario === 'probe') {
    for (const core of [0, 1]) {
      assert.equal(await call(symbols.modwerk_dsp_probe, core), 1, 'the base sends the probe')
      await settle(120); console.log('probed core', core)
    }
    bench.socket.end(); process.exit(0)
  }
  const data = new Uint8Array(readFileSync(file)), id = new DataView(data.buffer).getUint32(28)
  // Emulator-only reads: a three-instruction routine in the unused end of the boot stage returns a long.
  const at = symbols.modwerk_boot_stage + 0x130000, long = async address => {
    await bench.command(`poke 0x${at.toString(16)} 2079${address.toString(16).padStart(8, '0')}20084e75`) // movea.l (addr).l,a0; move.l a0,d0; rts
    return (await call(at)) >>> 0
  }
  if (scenario === 'restore') { // install once the loaded project names the module and the unit has said it is missing
    for (let tries = 0; tries < 120 && !(await long(symbols.modwerk_dsp_missing)); tries++) await settle(10)
  }
  if (scenario === 'missing') {
    const bank = await long(0x46c82456), hex = n => n.toString(16)
    assert(bank, 'a project is loaded')
    await settle(5) // ot_emu serves the next poke once its run loop has turned again
    for (let part = 0; part < 4; part++) await bench.command(`poke 0x${hex(bank + 0x8ed80 + part * 6322 + 8)} ${hex(EFFECT)}`) // T1's FX2 in every Part
    await bench.command(`poke 0x${hex(LIVE_FX + 8)} ${hex(EFFECT)}`)
    await settle(120)
    assert(await call(symbols.modwerk_dsp_used) & 1 << EFFECT, 'the bank reports the effect in use')
    console.log(`T1 names ${pkg.key} before it is installed; the bank reports it in use`)
  }
  if (scenario === 'stock') { // no module: the project's stock effects load at boot, then two reverbs are picked
    await settle(60)
    await pick(0, 1, proofs.configuration.fx2.indexOf('PLATE REV')); await pick(4, 1, proofs.configuration.fx2.indexOf('DARK REV'))
    bench.socket.end(); process.exit(0)
  }
  await keep(data); console.log('module installed')
  await settle(60) // the manager handles the project's own effects in its first ticks
  // missing: what the project named is restored; restore: install only (old_projects.py checks the result).
  if (scenario === 'missing' || scenario === 'restore') { await settle(300); bench.socket.end(); process.exit(0) }
  await pick(0, ...place(proofs))
  if (scenario === 'pick') await pick(4, ...place(proofs))
  if (scenario === 'cycles') await pick(1, ...place(proofs))
  if (scenario === 'beside') {
    await pick(4, ...place(proofs, true))
    await pick(1, 1, proofs.configuration.fx2.indexOf('PLATE REV')); await pick(5, 1, proofs.configuration.fx2.indexOf('DARK REV'))
  }
  if (scenario === 'remove') {
    await assert.rejects(session.stage(removal(base, id)), e => e.status?.result === 'rejected')
    console.log('removal refused while track 1 runs the effect')
    await pick(0, 1, 1) // FILTER
    await keep(removal(base, id).data); console.log('module removed')
  }
  bench.socket.end()
} else if (mode === 'check') {
  const [dir, out] = args, { proofs } = build(dir)
  const words = Array.from({ length: pkg.words }, (_, i) => parseInt(pkg.code.slice(i * 6, i * 6 + 6), 16))
  const log = readFileSync(join(out, 'log.txt'), 'utf8'), bytes = name => readFileSync(join(out, name + '.bin'))
  const u32 = name => Array.from({ length: bytes(name).length / 4 }, (_, i) => bytes(name).readUInt32BE(4 * i))
  const ids = [...bytes('ids')], peek = (core, space, at, n) => {
    const m = log.match(new RegExp(`core ${core} ${space}:0x${at.toString(16).padStart(5, '0')}:((?: [0-9a-f]{6}){${n}})`))
    assert(m, `no ${space} memory of core ${core} in the log`)
    return m[1].trim().split(' ').map(w => parseInt(w, 16))
  }
  // What core `core` runs for the effect: its code word for word where its dispatch points, inside the arena, or the null stub.
  const core = (number, tag, bound) => {
    const layout = proofs.dspLoader[tag], dispatch = peek(number, 'X', 0x215, 64), entry = [dispatch[EFFECT], dispatch[32 + EFFECT]]
    if (!bound) return assert.deepEqual(entry, layout.null, `core ${number} still dispatches the effect`)
    const table = parseInt(layout.table, 16), size = parseInt(layout.tableWords, 16), at = entry[0] - pkg.init
    assert(at >= table + 64 && at + words.length <= table + size, `core ${number} runs the effect outside the arena`)
    const placed = words.map((w, i) => pkg.relocations.includes(i) ? (w + at) & 0xffffff : w)
    assert.deepEqual(peek(number, 'P', table, size).slice(at - table, at - table + words.length), placed, `core ${number} code`)
    assert.equal(entry[1], at + pkg.proc, `core ${number} dispatch`)
  }
  // Resident words per core: each distinct effect its four tracks run, stock packages loaded on demand too.
  const resident = () => [[4, 5, 6, 7], [0, 1, 2, 3]].map((tracks, n) => [...new Set(tracks.flatMap(t => [ids[t], ids[8 + t]]))]
    .reduce((sum, fx) => sum + (fx === EFFECT ? pkg.words : proofs.dspLoader['AB'[n]].stock[fx]?.count ?? 0), 0))
  // Every stock effect core `number` runs on `tracks` is bound in its arena, entries as its package says.
  const stockBound = (number, tag, tracks) => {
    const layout = proofs.dspLoader[tag], table = parseInt(layout.table, 16), end = table + parseInt(layout.tableWords, 16)
    const dispatch = peek(number, 'X', 0x215, 64)
    for (const fx of new Set(tracks.flatMap(t => [ids[t], ids[8 + t]]))) {
      if (!layout.stock[fx]) continue
      assert(dispatch[fx] >= table + 64 && dispatch[fx] < end && dispatch[32 + fx] < end, `core ${number} does not run effect ${fx} from its arena`)
      assert.equal(dispatch[32 + fx] - dispatch[fx], layout.stock[fx].proc - layout.stock[fx].init, `core ${number} effect ${fx} entries`)
    }
  }
  if (scenario !== 'probe') assert.equal(u32('dl_errors')[0], 0, 'transport errors')
  if (scenario === 'pick') {
    assert.equal(ids[8], EFFECT); assert.equal(ids[12], EFFECT)
    assert.deepEqual(u32('dl_residency_words'), resident()); assert.equal(u32('dl_selection_refused')[0], 0)
    core(0, 'A', true); core(1, 'B', true)
    console.log('E-Verb picked on FX2 of T1 and T5: each core holds its code word for word and dispatches to it: passed')
  } else if (scenario === 'remove') {
    assert.equal(ids[8], 4); assert.deepEqual(u32('dl_residency_words'), resident()); core(1, 'B', false)
    console.log('removal refused while T1 ran E-Verb; after FILTER was picked it was removed and core 1 freed its code: passed')
  } else if (scenario === 'cycles') {
    assert.equal(ids[8], EFFECT); assert.notEqual(ids[9], EFFECT)
    assert.equal(u32('dl_selection_refused')[0], 1); assert.equal(u32('dl_modal_shown')[0], 1)
    assert.deepEqual(u32('dl_residency_words'), resident()); core(1, 'B', true)
    console.log('declared the most cycles a module may: T1 admitted, T2 on the same core refused with a message and left as it was: passed')
  } else if (scenario === 'missing') {
    assert.equal(ids[8], EFFECT, 'T1 runs E-Verb again'); assert(u32('modwerk_dsp_missing')[0] >= 1, 'the unit said it was missing')
    assert(u32('dl_parked')[0] >= 1 && u32('dl_reinit')[0] >= 1, 'the slot waited for the code, then started from its init')
    assert.deepEqual(u32('dl_residency_words'), resident()); core(1, 'B', true)
    console.log('a project naming E-Verb before it was installed ran dry and said so; installing it restored T1 from its init: passed')
  } else if (scenario === 'beside') {
    const [a, b] = [place(proofs), place(proofs, true)].map(([slot]) => slot ? 8 : 0)
    assert.equal(ids[a], EFFECT); assert.equal(ids[b + 4], EFFECT); assert.equal(ids[9], 20); assert.equal(ids[13], 22)
    assert.equal(u32('dl_selection_refused')[0], 0); assert.deepEqual(u32('dl_residency_words'), resident())
    core(0, 'A', true); core(1, 'B', true); stockBound(0, 'A', [4, 5, 6, 7]); stockBound(1, 'B', [0, 1, 2, 3])
    const held = [[4, 5, 6, 7], [0, 1, 2, 3]].map((tracks, n) => [...new Set(tracks.flatMap(t => [ids[t], ids[8 + t]]))]
      .map(fx => fx === EFFECT ? pkg.key : proofs.dspLoader['AB'[n]].stock[fx]?.key).filter(Boolean).join(', '))
    console.log(`${pkg.key} on T1 and T5 beside stock effects, every one bound in its core's arena (core 1: ${held[1]}; core 0: ${held[0]}), ` +
      `residency ${u32('dl_residency_words').join('/')} words: passed`)
  } else if (scenario === 'stock') {
    assert.equal(ids[8], 20); assert.equal(ids[12], 22); assert.equal(u32('dl_selection_refused')[0], 0)
    stockBound(0, 'A', [4, 5, 6, 7]); stockBound(1, 'B', [0, 1, 2, 3])
    assert.deepEqual(u32('dl_residency_words'), resident())
    const loaded = [...new Set(ids)].filter(fx => proofs.dspLoader.A.stock[fx]).map(fx => proofs.dspLoader.A.stock[fx].key)
    console.log(`stock effects on demand: ${loaded.join(', ')} each run from their core's arena (PLATE REV picked on T1, DARK REV on T5): passed`)
  } else if (scenario === 'meter') {
    const [serial, least, most, sum, missed] = u32('modwerk_dsp_meter')
    assert.equal(u32('modwerk_dsp_meter_core')[0], 0); assert.equal(u32('modwerk_dsp_meter_bits')[0], 120, 'all 120 bits read')
    assert(serial >= 1 && least <= sum / 1024 && sum / 1024 <= most, 'a whole window')
    console.log(`load meter: window ${serial}, idle iterations least ${least}, mean ${(sum / 1024).toFixed(1)}, most ${most}, missed ${missed} (emulator timing): passed`)
  } else if (scenario === 'probe') {
    const answered = proofs.configuration.dsp.probe !== 'A'
    assert.equal(u32('modwerk_dsp_probes_ok')[0], answered ? 2 : 0); assert.equal(u32('modwerk_dsp_probes_failed')[0], answered ? 0 : 2)
    assert(u32('dl_frames')[0] > 1000, 'frames kept running')
    console.log(`probe ${proofs.configuration.dsp.probe ?? 'none (whole receiver)'}: each core ${answered ? 'answered' : 'took the packet and never answered, as built'}, frames kept running: passed`)
  } else throw new Error('Unknown scenario ' + scenario)
} else {
  console.error('Usage: verify-octatrack-dsp-loader.mjs dumps BUILD OUT | drive SOCK BUILD SCENARIO PACKAGE | check BUILD OUT SCENARIO[:MODULE] (pick, remove, cycles, missing, restore, probe, stock, beside)')
  process.exit(2)
}
