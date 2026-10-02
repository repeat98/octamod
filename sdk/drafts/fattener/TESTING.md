# Fattener testing

## Commands and exact revision

All results are for this draft's files on top of Octamod `main` at
`56f3f936207b7bae53842bfe5293acb2ff8e6f3f` (2 Oct 2026, after #53), with the
vendored DSP56300 tree built from `sdk/octabam/scripts/vendor.sh dsp56300`
(pin `8ccdd843`, `tools/patches/dsp56300.patch` applied) on Linux x86-64.

| file | SHA-256 |
|---|---|
| `fattener.asm` | `73169fb714724ab4db5ac2729488e4f7d181ee1cb003b1ddaabdb64c887ab3df` |
| `manifest.py` (with the P table) | `cc415a5b9250d67d33f21a8fa641b4b89bee4514a50ccba0f41d58820147f950` |
| `gen_asm.py` | `74dc8f6078436c582867f30156846422bd95e7e57f772a8e32df1abd93f29a4d` |
| `reference.py` | `1b34cb7f85de2d1a3bb6250d30d1f381dbf85d89977de926e5ae154ad522de03` |

The source is generated: `python3 gen_asm.py` rewrites `fattener.asm` and
the `PTABLE` block of `manifest.py` byte for byte (gate 1 of `verify.py`
checks both). `FAT_EQEF=2` writes second-order error feedback in the EQ for
comparison; it is not the committed file.

### Source of the algorithm

`reference.py` is `JClones_Fattener.jsfx` from
https://github.com/JClones/JSFXClones at
`88a1503d668c378ced4c166e772378272f3b72ea` (MIT, version 1.1.0), line for line
at 44.1 kHz: the RBJ highpasses and peak EQ with the JSFX's digital-Q
correction, `this.level_s` per channel object fed the shared max(|L|, |R|),
`(level_s / threshold)^(ratio − 1)` above the threshold, and the tanh clip.
Its knob mapping is FAT and COLOR = value/127 (the JSFX's 0–100 %) and GAIN
= (value − 64) · 0.375 dB. `render()` is `JSFX(4x)/4` limited to ±1;
`render_jsfx()` is the JSFX alone; `render_model()` is what the module
computes (below).

## Two builds

**OCTABAM10** (first build, `fattener.asm` `e61c82f7…`) followed the JSFX
exactly: 951 words, 334 cycles/sample, peak error 4.6e-4 against the JSFX.
It cost more than stock SPRING REV (four per core: 22,748 against 20,376
instructions per block), and COLOR's precompute (sines, cosines, three
divisions; about 390 instructions) ran in every block where COLOR moved. On
the author's unit it gave CPU overruns in some situations under p-locks and
scene-fader moves. The author asked for it to be cheaper, with accuracy
less important.

**OCTABAM11** (this source) computes `reference.render_model()`:

| change | saved | cost in sound (float, against the JSFX) |
|---|---|---|
| one highpass, 36.5 Hz Q 0.78, for the 20 + 30 Hz pair | ~40 instructions/sample | within 0.5 dB from 20 Hz up; −15.4 against −18.6 dB at 15 Hz |
| the EQ's five words interpolated between 17 designs | ~260 per block where COLOR moves (128 left: 3,252 against 3,124 a block) | within 0.17 dB of the exact EQ |
| the gain once per 16-sample block, ramped linearly; the envelope still every sample | ~50 instructions/sample | output level within 0.24 dB, THD within 0.1 dB (gate 9) |
| the soft clip's constants through one pointer, parallel moves; its sign from h | ~20 instructions/sample | none |
| tables copied from a P table in init instead of computed | init 3,329 → 549 | none |

Before choosing the per-block gain, a version that also ran the envelope
on 16-sample peaks was measured: 3 dB more compression on noise, so the
envelope stays per sample.

The EQ keeps first-order error feedback: second order (`FAT_EQEF=2`) held a
limit cycle at COLOR 5 (1.4e-3 at full gain a second after a burst), first
order decays to exact zero at every COLOR.

## The render gate

`python3 verify.py` (set `DSP_ASM`, `DSP_HOST` and `DSP_DISASM` when the
draft is outside `sdk/octabam`). The module's P table is placed right after
its code and the source's `$fab1e0` pointed at it, as `build_bus.py` does:

```
[PASS] fattener.asm and the manifest's PTABLE are gen_asm.py's output
assembled 473 words of code + 225 of P table; init P:2000 proc P:2014, frame 186 words
[PASS] frame is straight-line, one rts
[PASS] no mpysu anywhere []
[PASS] FAT/COLOR/GAIN (127, 0, 127): zero in, zero out
[PASS] FAT/COLOR/GAIN (127, 127, 127): zero in, zero out
[PASS] garbage block $7fffff, FAT/COLOR/GAIN (0, 0, 64): zero in, zero out
[PASS] garbage block $7fffff, FAT/COLOR/GAIN (127, 90, 127): zero in, zero out
[PASS] garbage block $800000, FAT/COLOR/GAIN (0, 0, 64): zero in, zero out
[PASS] garbage block $800000, FAT/COLOR/GAIN (127, 90, 127): zero in, zero out
[PASS] garbage block $400000, FAT/COLOR/GAIN (0, 0, 64): zero in, zero out
[PASS] garbage block $400000, FAT/COLOR/GAIN (127, 90, 127): zero in, zero out
[PASS] garbage block $5a5a5a, FAT/COLOR/GAIN (0, 0, 64): zero in, zero out
[PASS] garbage block $5a5a5a, FAT/COLOR/GAIN (127, 90, 127): zero in, zero out
[PASS] FAT/COLOR/GAIN (127, 0, 127): exactly zero 0.9 s into silence after a 60 Hz burst (last non-zero output 137 ms after the burst)
[PASS] FAT/COLOR/GAIN (127, 64, 127): exactly zero 0.9 s into silence after a 60 Hz burst (last non-zero output 137 ms after the burst)
[PASS] FAT/COLOR/GAIN (127, 127, 127): exactly zero 0.9 s into silence after a 60 Hz burst (last non-zero output 137 ms after the burst)
[PASS] peak error vs the model within tolerance worst 2.14e-03 (tolerance 2.50e-03) at FAT/COLOR/GAIN (20, 10, 32), signal 50, level 0.8; 2.14e-03 where the tolerance is 0.0025
[PASS] stereo link: L loud, R quiet, both follow the model's shared envelope max error 2.95e-04
[PASS] stereo link: R silent stays exactly silent beside a loud L
[PASS] split 7/9 blocks follow the model's per-call ramp max error 4.95e-05
[PASS] FAT/COLOR/GAIN (64, 0, 64) at AMP VOL 64: the JSFX's THD at 0 dBFS module -13.7 dB, JSFX -13.7 dB
[PASS] FAT/COLOR/GAIN (127, 64, 64) at AMP VOL 64: the JSFX's THD at 0 dBFS module -10.3 dB, JSFX -10.2 dB
[PASS] output level within 0.5 dB of the JSFX's (sine, kick, noise; five settings) worst +0.24 dB at FAT/COLOR/GAIN (30, 90, 40), kick
[PASS] every knob moving every block: <= 215 instructions/sample 203.2 in the worst block
all FATTENER gates passed
```

Gate 6's tolerance is 2.5e-3, or 5 LSB of the filter chain times the
module's gain where that is larger. The worst case without gain is the EQ
at COLOR ≈ 10, where its poles sit close to z = 1 and its 24-bit words move
the response by up to 0.13 dB around 40–50 Hz (2.1e-3 on a −2 dBFS 50 Hz
sine). At FAT 127 and GAIN 127 the chain's last bit reaches the output
63 dB louder; the worst there is 5.1e-3 on an impulse tail, against 7.3e-3.

Gate 8 changed with the per-block gain: a call boundary inside a block (a
trigger) now starts a new ramp, so split calls are no longer bit-identical
to unsplit ones; they match the model with the same boundary.

## Silence and the whine

octabam's first Fattener was dropped for a whine, which its rebuild traced
to a limit cycle in the near-DC filters that the compressor's makeup made
audible. Here the highpass feeds its truncation error back second-order and
the EQ first-order, so a zero input decays to exactly zero: gates 4 and 5
(zero in gives zero out at the dearest settings and from a block pre-filled
with garbage; a 60 Hz burst at FAT 127, GAIN 127 is followed by exact zeros
137 ms after it ends, at COLOR 0, 64 and 127). The SDK's
`verify_dirtystate.py` stops on this remix with "no module named 'send'",
so its test is repeated in `verify.py`.

## Cost

- **Static** (`cycle_count.py --verify`, composed image): 193 cycles/sample,
  the frame routine (185 words) inlined plus the loop; first build 334. No
  branch in it, so every setting costs the same. Four per core 772; eight
  (FX1 and FX2 on four tracks) 1,544 against 3,120 usable.
- **Executed, one instance** (`verify.py` gate 10): 203 instructions/sample
  in the worst block with every knob moving every block, block work
  included; first build 352.
- **Init:** 549 instructions per instance, once per selection.

### Benchmark against SPRING REV

`REMIX=fattener-spring python3 modules/fattener/benchmark.py` (the draft
copied to `sdk/octabam/modules/fattener/`), 2,048 blocks, both cores booted
from their payloads, executed instructions per 16-sample block:

| case | Fattener | first build | Spring Reverb |
|---|---:|---:|---:|
| one instance, fixed knobs (mean) | 3,124 | 5,239 | 4,186 |
| four per core, fixed | 13,008 | 22,252 | 16,744 |
| four per core, every control moving | 13,008 | 22,528 | 16,748 |
| four per core, worst (moving, trigger split) | 13,536 | 22,748 | 20,376 |
| init, four per core | 2,196 | 13,316 | 380 |

All 16 synchronized trigger-split positions were run; none exceeds 13,536.
These are instructions, not hardware cycles; the meter excludes the
dispatcher, ColdFire work, DMA and memory stalls.

## Composed image

`make image REMIX=fattener-spring BUILD=11` (`hardware-test-remix.py`
copied to `remixes/fattener-spring/remix.py`), with the author's local MAIN OS
(`164f3122…0a84e`):

```
FATTENER       id 0x0e  clone P=0x400d6b20  knobs [0, 1, 2]
XTABLE: P tables stay in P -- DJ EQ reads the stock curve bank X:0x04840 and is kept in the image
PTABLE        P:0x01252..0x01333 ( 225 words)  FATTENER's table
FATTENER      P:0x01333..0x0150c ( 473 words)  id 0x0e      (payload A)
region P:0x01252..0x01679 (1063 words)  used 698  FREE 365
PTABLE        P:0x01012..0x010f3 ( 225 words)  FATTENER's table      (payload B)
FATTENER      P:0x010f3..0x012cc ( 473 words)  id 0x0e
round-trip: payload ok, checksum ok
```

| artifact (local only, never committed) | SHA-256 |
|---|---|
| `out/mainos_bus.bin` (BUILD=11) | `9500e5bcee18addae560b539966306533886b319019572bf8977a5c51721f650` |
| `out/OCTATRACK_OCTABAM11.bin` | `4d92c97d1a81393613fe91235920e9d6b2a14371566b59d8d360053c95c286ff` |
| `out/OCTATRACK_OS1.40C_OCTABAM11.syx` | `7ffb973897452354e2be24c2db8de33b3e94f2b5a16544dffbd9ee25c1fc6739` |
| `out/mainos_bus.bin` (BUILD=10, first build) | `39388d4b0214e33fc52f4d033f8aa13e681bcb9c54bd7e69923568b49ce7a312` |
| `out/OCTATRACK_OCTABAM10.bin` | `ef43ab306205daed692bfc8d0a7c865ea0404426107d1028cf1b700f0013f4d9` |

The image was built before two comment lines in `gen_asm.py`'s header
and `manifest.py`'s docstring and proof note changed; the 473 code words and the 225 table words in payload A are
identical to the committed files assembled at P:0x1333 with the table at
P:0x1252.

On BUILD=11:
- `verify_menu` ALL CHECKS PASSED (the three drawn names are the
  manifest's), `verify_initregs` 0 failures, `verify_replaces --image` OK.
- `cycle_count.py --verify`: marker identical, 193 cycles/sample.
- The composed payloads, entered through their dispatch tables for id 0x0e,
  render FATTENER within 6.3e-4 of `reference.render_model()` (FAT/COLOR/GAIN
  0/0/64, 100/60/80 and 127/127/127, a 220 Hz tone and its decay), L = R, on
  both cores.

### LCD captures

`scripts/capture-module-ui.py` with `ot_emu` `2360ffb2…5115`, MKII panel,
empty scratch card: the chooser with FATTENER in SPRING REV's row, the main
page at the defaults, and FAT 80 / COLOR 40. Captured on BUILD=10 and again
on BUILD=11: byte-identical. `media/capture.json` has the plan and hashes.

## Hardware

- OCTABAM10 (first build), author's unit, 2 Oct 2026: CPU overruns in some
  situations under p-locks and scene-fader moves. This led to OCTABAM11.
- **OCTABAM11 (this source), MKII, 3 Oct 2026:** about ten minutes with Fattener on four
  tracks under heavy load (p-locks and scene moves), reported as "works great": no
  overruns. A listening test, not a stress run, measured timing or recovery test.

## Not done

- Hardware: the 60-minute eight-track stress project and worst-case cycles under modulation on the unit.
- Native/browser packaging parity and catalog integration.
- `npm run lint`, `npm test` and `npm run build`: the session's npm registry
  refused the app's packages. `modules:check` and `sdk:check` pass, and the
  draft test was run under Node with a minimal vitest stand-in.
