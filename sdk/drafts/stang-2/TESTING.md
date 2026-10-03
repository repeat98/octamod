# Stang 2 testing

Version: `0.1.0-experimental`. Date: 3 October 2026.

## Evidence scope

Core behavior has firmware-free tests; UI capture is a separate private native
build. Neither is an audio render, firmware/DSP qualification test, hardware
stress run or evidence of flash safety. Native discovery and the public catalog
exclude this draft. `verify_native.py` is a deliberate failing gate.

## Firmware-free core

Executed with Apple clang 21.0.0 in a macOS sandbox: network denied; clean
environment; file reads restricted to original sources and system/toolchain
paths; writes limited to the private temporary task workspace. ASan and UBSan
were enabled. No firmware is used by this test executable.

```sh
clang -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  engine.c test_engine.c -o <private-work>/test-engine
<private-work>/test-engine
```

Passed: **244,800 deterministic/scale/density cases**, lengths including 1 and
64, all five scales, all twelve roots, every density and multiple seed/type
values. Pitch remains in scale and inside ±12 semitones. Increasing density
retains prior events; density zero is silent and 16 fills the active length.

Passed native-record writer checks on synthetic buffers: real trig-mask and
pitch-lock writes; no overwrite on an auto-fill request with existing notes,
locks or recorder content; preservation of all swing mask bytes and native
length/speed/swing controls; preservation of recorder, LFO, FX and sample locks;
trigless-lock continuity on rests; invalid phrase rejection before any write;
short buffer refusal and surrounding canaries; seed wrap. Sanitizers reported
no error. Exact tested file identities and the result are recorded in
[media/core-tests.json](media/core-tests.json). STOP/PLAY relies on the native adapter not calling replacement;
that adapter behavior is not established by the pure core tests.

## Private native build and LCD capture

GNU m68k-elf-gcc compiles original C with `-mcpu=5475 -msoft-float -O2
-ffreestanding -fno-builtin -fno-common -fno-jump-tables
-fno-asynchronous-unwind-tables -fno-ident -fomit-frame-pointer
-fno-zero-initialized-in-bss -Wall -Wextra -Werror`.

`prepare.py` verifies original MAIN OS SHA-256
`164f31224bf61181e3f50e7dec40df9afcae5b16dbf6e4c0d0cc5e986af0a84e`, derives
four replay spans locally, and emits private `runtime.s`. All native detours
and writes are separately guarded by address/length/hash in `manifest.py`.
The native remixer builds stock FX plus STANG 2 with static stock DSP and no
other pending modules. The capture emulator runs with transport stopped on a
new empty scratch card, through actual panel actions, without RAM patching or
internal menu invocation. Failed navigation attempts are discarded.

The local preparation command is:

```sh
python3 -B <private>/modules/stang-2/prepare.py \
  --stock <private>/out/raw/section_3_MAIN_OS.bin \
  --output <private>/modules/stang-2/runtime.s
```

Use the isolated SDK native build with the exact stock-only FX + STANG 2 profile
and flags recorded in `media/capture.json`. The final source rebuild reproduced
image SHA-256 `48f3be3af84c64b51d22bf7047a44609a5f59a85c5b875d4474aef8a791a98b9`.
The accepted capture plan is the record's `plan` array, saved as `panel-plan.json`:

```sh
python3 -B scripts/capture-module-ui.py \
  --emulator <private>/ot_emu --image <private>/out/mainos_bus.bin \
  --image-sha256 48f3be3af84c64b51d22bf7047a44609a5f59a85c5b875d4474aef8a791a98b9 \
  --plan <private>/panel-plan.json --output <private>/captures
```

Run both commands inside the documented isolation boundary. Angle-bracket
paths identify private local files, never inputs for CI or website builds.
Exact image/emulator/source hashes, capture tool identity and accepted panel
plan are in `media/capture.json`. Real LCD pixels are scaled by six and kept
monochrome. Reviewed screenshots establish only the shown UI behavior.

## Memory and cycles

The generator has bounded integer work (at most 2016 insertion comparisons,
64 pitch decisions, and a fixed-size native-record update). It has no heap or
floating-point dependency. `StangPhrase` holds 64 four-byte events plus length;
the adapter stages one 2,330-byte native track record, plus UI/input state.
Stack includes two 64-element rank/order arrays and scale candidate storage.
The native UI window uses the stock allocator. Full allocation peaks, linker
regions, stack bounds, allocator/canary evidence and timing are not measured.

The DRAM platform reserves 1,707 pages, 10,487,808 bytes, off the shared audio
pool. This is a loader reservation, not an estimate of Stang's algorithm size.
Source-backed relative gauges account for it. There is no claim of zero-cost
DSP playback: the generator adds no DSP kernel, but stock sample/FX work still
scales with trigger density. Worst-case ColdFire and full playback-system
budgets under modulation, mode changes and maximum load remain required.

## Outstanding native acceptance

Verify on a disposable local project before hardware use: first PLAY with no
trigs, other-track/MIDI-page transport, occupied tracks untouched, stable
STOP/PLAY, replacement and cancellation, all eight tracks, native grid and
pitch/HOLD/VOL edits, saved SRAM/card data, Part/bank/pattern reload and power
cycle, Flex and Static selection/playback, recorded and manual locks, mode
switches, and every relevant UI press/release path. Check exact stock writer
ABIs for dirty/lock-index/track publication and the project validator's handling
of NEIGHBOR storage. Do not infer persistence from writing a mirror address.

Swing acceptance must compare native generated trigs against manually entered
trigs on the same track, with matching swing mask, track scale and length;
include 50–80 swing, odd lengths, all track speeds, pattern changes and tempo
changes. Euclid follows those same native timing settings; Stang must preserve
them and let the native sequencer consume the result. Host tests prove byte
preservation only, not audio timing equivalence.

## Hardware and release

Untested. As requested in this task, require a passed continuous **60-minute
real MKI or MKII run with all eight audio tracks active**, worst-case parameter
modulation/mode changes/load, exact memory and per-processor cycle reports,
module-version/native-source/local-image hashes and owner verification of actual
reports. Preserve honest coverage and unknowns; do not invent zero metrics.

Keep `qualification.example.json` pending and outside `tests.qualification`.
Native integration, stock-free browser packaging, byte parity and rejection
checks, review and owner merge are required before catalog integration or any
firmware download. Ordinary `npm run check` runs no native source, emulator,
firmware, DSP or hardware tests.

## Application/static validation

Node 24: `npm run check` passed (293 domain tests, 18 SDK source/data checks,
licence checks, lint, type checking and production build). The Stang tests in
`src/catalog/stang-2-draft.test.ts` read source identities, evidence metadata,
monochrome PNG pixels, README/tutorial consistency and publication rejection.
They execute no submitted C/Python/assembly, emulator or firmware. The only
build diagnostic is the existing large-bundle advisory.
