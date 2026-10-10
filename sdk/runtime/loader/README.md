# Runtime module loader

Loads, replaces, rolls back and removes ColdFire modules on a running
instrument without a reboot, up to 32 at once: each with its own code and
data, hooks on the machine's hook bus, and patches to stock code. It is the backend of the
[upload controller](../upload/README.md) and does not depend on a machine:
every instrument Elekloader supports (Octatrack, Digitakt mk1 and mk2,
Digitone) has a ColdFire V4 CPU and a hook bus with tick, draw, key and
encoder events. Development only; the Octatrack is the first machine with
glue.

| File | What it is |
| --- | --- |
| [`modwerk_module.h`](modwerk_module.h) | What a C module sees: its four handlers and the test value |
| [`build.py`](build.py) | Builds a package from C sources, or from a catalogue module converted by Elekloader |
| [`verify_static.py`](verify_static.py) | Proves a package places the same bytes as Elekloader's static link of the module |
| [`loader.h`](loader.h), [`loader.c`](loader.c) | The loader and the glue a machine provides |
| [`tests/host_test.c`](tests/host_test.c) | Host test, run by `sdk/tests/test_runtime_loader.py` |

## Package, ABI 4

Big-endian. Header (32 bytes): `MWRM`, ABI u16 = 4, flags u16 = 0, image
length u32, bss length u32, relocation count u32, hook count u32, site count
u32, module id u32. Then one u32 offset per hook (`0xffffffff` for none),
the image (code, read-only and initialized data), one u32 offset per
relocation, and the sites: address u32, length u16, relocation count u16,
the stock bytes, the new bytes, and one u16 offset per relocation in the new
bytes. An ABI 3 package is the same without the id (a 28-byte header) and
is module 0.

- The id names the module: a package with a live module's id replaces it,
  any other loads beside the live ones, and one with no image, hooks or
  sites removes that module. `build.py` takes the first four bytes of the
  SHA-256 of the module's name (the elemod's id, or the output file's stem).

- Hooks, in this order: `module_tick`, `module_draw`, `module_key`,
  `module_enc`. Later events append. A base refuses a package with more hooks
  than it dispatches; hooks a package does not list are empty.
- A relocation names a 32-bit word (of the image or of a site's new bytes)
  that holds an offset into the module. The loader adds the module's address.
  A word that points outside the module, or one listed twice, is refused.
- A site replaces whole stock instructions: even address and length, at most
  32 bytes, inside the stock code the machine allows, not overlapping another
  site of the package.

From C, `build.py` links the module twice, at 0 and at 0x10000: the words
that differ by exactly 0x10000 are the relocations, and any other difference
(such as a 16-bit reference to the module) is refused. From a converted
catalogue module (`sdk/machines/octatrack/elekloader/build_ports.py`), it
lays out the `.run` section with the stock bytes it copies, resolves the
listed relocations, imports from the base's symbol map, and checks every
site's stock bytes against their recorded hash. Such a package holds stock
bytes: keep it private, like a firmware image. `verify_static.py` then links
the same module statically with Elekloader and requires the package, placed
at the same address, to match it byte for byte.

```sh
python3 -B sdk/runtime/loader/build.py MODULE.c -o MODULE.mwrm
npm run device -- try MODULE.mwrm --seconds 10   # scripts/device.mjs
```

## DSP code (ABI 5)

ABI 5 is ABI 4 with an 18-byte DSP descriptor after the module id, for a
machine whose OS runs effects on DSPs (the Octatrack): DSP word count u32,
relocation count u16, effect id u8, slots u8 (1 FX1, 2 FX2), init u16,
process u16, worst-case cycles per sample and instance u16, the kind of
that figure u8 (1 executed instructions, 2 modeled cycles, 3 hardware),
state words per instance u8, and the delay-buffer words it reads from its
slot's base u16. After the sites come the words (u32, 24 bits each) and the
relocations (u16, rising; each names a word holding an offset into the
code). The effect id is only the module's preferred one: modules are known
by their module id, and the machine's admission (`modwerk_machine_dsp_admit`)
gives each effect the id it gets, a handle, and says whether its DSPs can
take it. The loader keeps that id and hands the effect over at the switch
(`modwerk_machine_dsp_switch`), masked with the module's hooks and sites. The code itself goes into a DSP only when a track
picks the effect (the Octatrack's `dsp.c`). `build.py --dsp` makes one from
a DSP package Modwerk's builder proved, and checks those proofs again.

## Several modules at once

- **Admission before anything changes.** A package is refused, with the
  live set untouched, when another live module patches any byte of its
  sites (Elekloader's own rule: one owner per byte), when 32 modules are
  live, or when the pool has no free run large enough. The refusal reason
  (`modwerk_runtime_refusal()`: malformed, memory, conflict, full, busy)
  is kept for diagnostics and the unit's own message.
- **One position each.** A module keeps its dispatch position for life;
  replacement takes the same one, a new module the first free one. Tick
  and draw hooks all run, in position order; the first key or encoder hook
  that returns nonzero takes the event. Two modules wanting the same key is
  not detected (Elekloader's `resources.names` claims are not carried yet).
- **Memory is reclaimed.** Each module has one pool extent (its record,
  sites, code, data and bss), written and read only through the uncached
  alias. A module that no position or transaction holds is freed once,
  with interrupts masked, no paused task's stack or saved registers hold an
  address inside it; unknown task state frees nothing. `modwerk_runtime_free()`
  reports free bytes and the largest free run.
- **Not carried at run time:** `requires`, imports between modules and
  `contribute` tables. A module must not leave pointers to itself anywhere
  but its sites and hooks.

## Loading, and why it is safe

- **RAM only.** Module memory comes from a pool in the base. Sites are
  written only where the machine's `modwerk_machine_patchable` allows: on
  the Octatrack, the RAM copy of the stock OS image below the copy of the
  bootloader inside it that the OS can write to flash (past it, the DSP
  payloads' RAM holds the current bank once a project loads), never flash,
  peripherals or the base itself. A power cycle restores everything.
- **Exact bytes.** A site is written only over the stock bytes the package
  expects, read through the uncached alias; the result is read back. Any
  mismatch puts the previous module's bytes back and changes nothing.
- **Nothing runs while code changes.** Hooks and sites switch together with
  interrupts masked. First the loader checks every other task's live stack
  and saved registers: an address inside a site (other than its first byte)
  means a paused task could resume in the middle of a new instruction, so
  the switch is refused and can be retried. Unknown task state also refuses.
- **No overwriting running code.** Pool memory is reused only once no
  paused task can return into it (above). Data-cache lines of a site are
  pushed before it is written, and the instruction and branch caches
  invalidated after new code is written.
- Activation needs nothing playing or recording. A bus reset or unplug rolls
  back anything not accepted (the controller's disconnect).

## Porting to another machine

A machine provides, next to its base:

- `modwerk_machine_stopped()`: nothing plays or records.
- `modwerk_machine_uncached(p)`: the alias module code and data run from.
  Data accesses there must bypass the data cache.
- `modwerk_machine_invalidate_code()`: instruction and branch caches, with
  the OS's own cache-control value.
- `modwerk_machine_patchable(address, length)`, `modwerk_machine_code(address)`
  (an uncached view) and `modwerk_machine_flush_data(address, length)`.
- `modwerk_machine_mask()` / `modwerk_machine_unmask()`.
- `modwerk_machine_paused()`: every other task's live stack and saved
  registers, from the kernel's task records.
- Trampolines subscribed to its core's `ev_tick`, `ev_draw`, `ev_key` and
  `ev_enc`. Each reads every position (`modwerk_runtime_module(i)`) once
  and calls its hook.

The Octatrack's glue is
[`sdk/machines/octatrack/elekloader/runtime.c`](../../machines/octatrack/elekloader/runtime.c).
Key codes, encoder numbers, the frame layout and stock code addresses are the
machine's own, so a module is built for one machine and OS.

## Not yet

Patches to data tables (they need the data cache handled), modules that add
to the core's tables (`contribute`, such as CC MAP's MIDI handler), MIDI and
audio-frame hooks, shared DSP routines and the Part routes for DSP code
([design](../../../docs/OCTATRACK_ELEKLOADER_MIGRATION.md#several-modules-on-the-device-design-10-october-2026)),
pool memory taken from the arena on demand, a package that names the base
it was built for, and the browser builder.
