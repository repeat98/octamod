# Octatrack hardware traps

Things that work in the emulator or on paper and fail on a real Octatrack
MKII (OS 1.40C), found while bringing up the Modwerk base, its USB link and
the DSP loader on the owner's unit in October 2026. Read this before
changing the base (`sdk/machines/octatrack/elekloader/`), the upload
transport (`sdk/runtime/upload/`) or the DSP loader. Octabam's own traps are
in [sdk/octabam/AGENTS.md](../sdk/octabam/AGENTS.md); the long record with
every run is [OCTATRACK_ELEKLOADER_MIGRATION.md](OCTATRACK_ELEKLOADER_MIGRATION.md).

Each entry: what you see, why, the rule, and the build it was observed on.

## USB and EP0

**No EP0 IN reply may be a whole multiple of 64 bytes.** The unit froze
once: a stale zero-length packet made the next IN return 0 bytes and stock's
ISR looped until the next SETUP. Pad or size replies (IDENTIFY 72, DIAG 68,
the screen 1028, the loader report 4 × words with words not a multiple of
16). Observed on `usbtest2`; rule kept since.

**No EP0 OUT data stage may be a whole multiple of 64 bytes either, unless
ZLT is off.** Stock leaves zero-length termination on in the EP0 OUT queue
head, so a 128- or 192-byte SUBMIT never completed and the base abandoned
it (127, 191 and 255 worked). The base clears ZLT (dQH word 0, bit 29) when
it primes its data stage, and the client never sends such a frame (it
shortens that chunk by a byte), so older bases work too. `usbtest9`,
`508b0e52`.

**Windows binds WinUSB only to a USB 2.10 device that answers BOS and the
Microsoft OS 2.0 set.** Both requests reach the base through stock's
unknown-request STALL tail; the device descriptor needs a copy (stock's sits
in the protected bootloader range). macOS and USB disk mode are unaffected.
`usbtest8`. Windows itself is not tested yet.

**macOS keeps stale device entries after the unit disappears abruptly**
(`ioreg` shows inactive IOUSBHostDevice nodes held by `configd` or
`systemstats`). They are harmless; a power-cycled unit enumerates beside
them. If a unit does not come back at all, the cause is on the unit.

## RAM boot

**Only the flashed base's gate decides a RAM boot.** After the soft reset
the bootloader always unpacks the flashed image, so its gate reads the
mailbox. Each build puts its stage at another address, so a boot armed by a
RAM-booted base fell back to the flashed one. The gate (`usbtest9`) scans
the platform reserve for exactly one valid mailbox and spends every one it
finds; the build refuses a stage outside that range.

**A soft reset leaves the USB controller and its PHY as they were.** One RAM
boot in about six came back with the screen working and no USB until a power
cycle. The base now stops the controller (USBCMD.RS = 0) and waits about
50 ms before the reset; with that, 20 of 20 boots came back
(`usbtest9`, 12–16 s each).

**REMIX SWITCH's DSP park works for RAM boot.** Audio, sequencing and the
card were normal after RAM boots, including into bases with edited DSP
payloads.

**`npm run device -- boot` must wait for the unit to go away.** With the
same base before and after, its identity answers before the reset fires.
Wait for a failed request, then for HELLO (the engine refuses SUBMIT for a
moment after the restart).

## Simulating the user

**Never post key event records to stock's queues directly.** It crashed the
unit twice, minutes later, and a remote STOP made a brief distortion instead
of stopping: stock's handlers also read the panel parser's held-key rows.
Feed the parser the panel's own bytes through its byte ringer instead (row
report `0x20 | row` with the row's held keys, `0x30 | encoder` with a signed
delta, `0x40` with the fader position), masked as the UART interrupt does.
This is what octemu's emulated panel sends too. Remote PLAY, STOP and
auto-stop work this way (development base `54f2ce5c`).

**Moving the cursor in an FX chooser does not pick; YES does.**

**Auto-stop never stops a recording, and never for a disconnect's
rollback.** The controller answers `unsafe` while the unit plays (the
backend's "not stopped") and the host retries.

## DSP loader (dynamic DSP code)

**eDMA source buffers must match the inherited transfer size.** The loader
reuses stock's TCD0 and inherits its 16-byte bursts. Its packet buffer sat
4 bytes off a 16-byte boundary: the chip raised a source address error
(`ES` 0x80000080), the frame engine stopped, and nothing played until a
power cycle. The emulator does not check alignment. The buffers are now
aligned and the build refuses a misaligned one.

**When frames stop, everything stops.** Core 0 writes a word per frame and
waits for the ColdFire to take it; if the ColdFire's frame chain stops, the
sequencer sticks on its first step and USB audio has nothing to send. Read
the loader report (`npm run device -- report`): frames, job state, eDMA
`ES`, the TCD CSRs, stalls and drained words show where it stopped.

**A watchdog on the tick runs but cannot revive a dead frame chain.** Its
heartbeat kept climbing after every freeze, it detected the stall and
drained the frame words, but frames never resumed: a corrupted DSP needs
both cores stopped, parked and re-uploaded, as RAM boot does. Prevent the
collision instead of relying on the watchdog.

**Never select core 1 at state 7, not even to read its host flags.** The
loader read each core's answer flags by setting the DSP select byte
(`0xfc0a400c`) to the core and back, from state 7. For core 0 that wrote the
value already there; for core 1 it switched, and the frames stopped: with
a packet sent there, and with nothing sent at all (`dsp2-AB2`, `core1Sent`
0). Stock switches cores only early in the frame (state 2 selects core 1,
state 3 core 0). Core 1's packet now goes right after stock's state-2 push,
and its flags are read at state 3's entry, while state 2 still has it
selected. With that (`dsp2-AB3`, `35b48eb4`) core 1 answered a probe and
took E-Verb's 68 packets with frames running.

**Clean a host word before a 56-bit compare.** E-Verb's upload to core 0
was refused at its fifth packet every time: a WRITE whose opcode, count and
offset, masked to 16 bits, were all in range (record `$020003`, count 24,
offset 136, `dsp2-AB2`), with a good checksum and no overrun. The receiver
masked each word with `and #$ffff` and then used `cmp` and `do`, which read
all of A, and `and` leaves A2 stale (Octabam's own trap). The receiver now
rewrites the header words masked once, after the magic check, and tests the
magic with `eor` then `and`, whose Z flag looks only at A1. All 68 packets
then went through on the unit (`dsp2-AB3`). The fix confirms that some header
words reach the DSP with junk in bits 16 to 23. Which bits and why was not
measured.

**The project's working state survives a RAM boot.** Picks made under one
test base were still there after booting the next (stock keeps a working
copy of the project on the card): a chooser opened on E-Verb, the last row,
so a scripted DOWN did nothing. Read the screen before scripting a chooser.

**A project that used a static module triggers its load at install.**
Static E-Verb and dynamic E-Verb share effect id 27, so installing E-Verb
started an upload at once on a project that already used it. Test the loader
on a blank project first.

**Don't burn DSP time with `rep`, and not on core 1 without measuring it.**
A calibration build spending 2,000 more cycles a frame with `rep` on both cores
hung the unit at its logo (`dsp3-B2`); the emulator ran it. The same amount in
an interruptible DO loop on core 0 alone was fine. `rep` holds off interrupts
while it repeats, and core 1's headroom is not measured yet.

## The emulator and the tools

What `ot_emu` does not show:
- DMA finishes instantly, so races between transfers and stock's frame
  machine never appear.
- Unaligned eDMA addresses are accepted.
- Host reads wait for the DSP's word, so host-read traps never appear.
- It never restarts from RAM, so the park-and-upload path is not covered.
- `--dsp` dies with a bus error in Docker unless `--shm-size=128m`;
  `--frame` is needed for the audio producer (USB audio) to run.

**Drive the unit in one connection and read it as text.** Each `npm run
device` call opens the bridge again (about a second). `npm run device -- do
'T1 FX2 FUNC+FX2 DOWN*8 YES w1500 NO ui'` runs a whole sequence in one
connection, and `ui` prints each track's effects, the current track and the
transport from RAM (the development MEM request, read-only, RAM only). Take a
screenshot only for menus `ui` cannot name, at `--scale 2`.

Tools that work on this Mac:
- Development bases (`build_core.py --dev`): `npm run device -- key`,
  `enc`, `fader`, `state`, `screen [--png FILE]`, `loader`, `report`,
  `probe`, plus USB audio (MAIN and CUE).
- Recording: the repaired `rec.swift` (`sdk/machines/octatrack/hw/prepare_tools.py`,
  then `swiftc -O rec.swift -o rec; rec SECONDS OUT.wav Octatrack`).
  Homebrew's ffmpeg was broken (missing libx265).
- `dsp_asm` for `--dsp-loader` builds: build `source/dsp_host/dsp_asm` from
  Octabam's vendored `dsp56300` with CMake and set `ELEKLOADER_DSP_ASM`.
- Read device state in one USB connection when timing matters: separate
  `npm run device` calls each take most of a second.

## How to debug on the unit

1. RAM-boot a development base (`npm run device -- boot DIR`); a power
   cycle always returns to the flashed base.
2. Bisect with probe bases that differ in exactly one aspect, and read the
   report before and right after the step.
3. Watch the sequencer (two screen captures a second apart while playing)
   and USB audio; the loader's own counter freezes once it is switched off.
4. Keep the owner's projects out of it: a blank project avoids loads
   triggered by modules a project already uses.
