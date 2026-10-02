# Octamod SDK

For agent-driven additions and updates, execute [the standard module-addition workflow](../docs/MODULE_ADDITION_WORKFLOW.md). It includes source review/isolation, thumbnail, complete documentation/tutorial, actual LCD capture and qualification before the focused PR.

The developer entry point for the Octamod monorepo. The SDK, module source, web content and configurator stay together. It derives from [octabam](https://github.com/sambanks/octabam); original MIT copyright and component credits are retained under `octabam/LICENSE` and `octabam/THIRD_PARTY.md`.

The initial import includes **Spectrum, Modulation, Character, Mini Verb, Tape Echo, Euclid and Repitch**. It comes from a fresh upstream clone pinned to the exact fork revision in [UPSTREAM.json](UPSTREAM.json). On 1 October 2026, the owner expanded scope to Analog BD, MIDI Scenes, USB Audio (tracks + MAIN/CUE) and Scale Quantizer. Their latest source import and author pins are recorded in [imports/octabam-363861e.json](imports/octabam-363861e.json). USB MIDI is included as an internal dependency. On 2 October 2026, the owner also requested OctaKit; it is staged as a [source draft](drafts/octakit/README.md) outside native discovery and the public catalog until qualification and owner review are complete. Other octabam modules remain outside scope unless explicitly requested. Its required stock-loader infrastructure is isolated under `octabam/platform/`, outside the public module catalog. Two supported compositions and the crowded-selection rejection match the native builder byte for byte; the copied upstream Makefile is not yet a supported standalone firmware build command.

[CC Map](octabam/modules/cc-map/README.md) and [Preview Vol](octabam/modules/previewvol/README.md), requested on 2 October 2026, are released as `0.1.2-experimental`. They are visible, selectable and buildable in Octamod. Their pinned import records preserve authorship, MIT licences, source identities and lazy stock guards. Both have original thumbnails, full tutorials and actual monochrome MKII LCD captures. The owner explicitly waived physical stress testing and real-chip cycle measurements for these exact two source versions; both remain honestly untested/unmeasured. The [two-version waiver](module-release-waivers.json) is separate from the unchanged eleven-module baseline; future versions require full qualification. CC Map’s upstream FX2 block targets BusDelay/BusVerb, which remain outside scope.

TapeHead, requested on 2 October 2026, is an [experimental module](octabam/modules/tapehead/README.md): the JClones VladG TapeHead clone (MIT), ported to DSP56300 by devilfish707. It includes reference renders, both-core modulated/split benchmarks, exact memory/code-cycle records, a named tutorial and actual monochrome LCD captures. Hardware operation and parameter locks are author-reported; model, duration and maximum tested load were not supplied. The owner accepted that functional report and removed the mandatory one-hour stress requirement. Browser/native composition and packaging must pass before publication.

IronOxide5, requested on 2 October 2026, is an original [source draft](drafts/ironoxide5/README.md): Airwindows' IronOxide5 (MIT) tape emulation on the DSP, brought over from a local octabam module. Its `verify.py` runs the assembled code in `dsp_host` with no firmware and compares it with a line-for-line port of the plugin's processing; that render found the octabam per-sample path wrong (peak error 2.0), and it was rewritten and optimised. `benchmark.py` measures it against stock SPRING REV, `hardware-test-remix.py` builds a test image with IronOxide5 in Spring Reverb's chooser row, and emulator LCD captures are included. It stays outside native discovery and the catalog until hardware qualification and owner review are complete.

## Start without firmware or native compilation

Use Node 24 from the monorepo root:

```sh
npm ci
npm run modules:check
npm run module:new -- my-filter --kind dsp --author your-github-login
```

Use `--kind coldfire` for a CPU contribution. The scaffolder refuses to overwrite an existing module. It creates source, `manifest.py`, versioned `octamod.module.json`, README, TESTING, licence and a media directory. DSP scaffolds use an example ID; select an unused ID and write actual gates before use. The generated native verification gate fails deliberately until it is replaced with meaningful module-specific checks. A scaffold never becomes an installed or published module automatically.

New modules and updates also require worst-case cycles under parameter modulation and maximum load, exact memory allocation accounting, and owner-reviewed real-hardware operation evidence, labelled with its actual coverage and limitations. Complete the scaffold's `qualification.example.json` with actual measurements/results, then copy that object into `tests.qualification`. Release also requires the complete README/TESTING/licence/control documentation, a short practical tutorial and real black-and-white PNG screenshots in the online style; yellow captures are rejected. Fill the template’s documentation section and synchronize its tutorial and screenshot paths with README. The incomplete template cannot pass checks. Read [the qualification gates and source-fingerprint procedure](../docs/MODULE_QUALIFICATION.md). Local, PR and release checks enforce the record without running native source; the owner verifies the actual reports before merge. The existing eleven module versions/folder contents remain exempt through a frozen baseline, while later updates must qualify.

Module folders are `sdk/octabam/modules/<id>/`. Website metadata is plain JSON, validated without evaluating Python. After editing a catalog module, increase its semantic version and update its exact version in `sdk/catalog.json`. Regenerate:

```sh
npm run modules:generate
npm run check
```

The catalog pages read the generated catalog from these folders. Fields include controls, practical uses, compatibility, resource measurement methods/conditions, evidence revision, authors, licences and real media provenance. Read [the module contract](../docs/MODULE_REPOSITORIES.md) and [contribution rules](../CONTRIBUTING.md).

## Native development

Native source and reference tools are retained under `octabam/`, with historical namespace/path compatibility. Read `octabam/docs/remixer/MODULES.md` and `PLACEMENT.md` before altering memory claims. Do not execute uploaded or unreviewed manifests on a trusted workstation. Compilation must run in isolation without credentials; user firmware never enters automation.

The native toolchain requires Python 3.10+, CMake, a patched DSP56300 assembler/disassembler, GNU m68k-elf tools and locally supplied original OS 1.40C for composition and firmware-dependent gates. The platform migration has passed local native composition parity. Portable developer setup remains in progress; approved source-to-package automation compiles reviewed code in an isolated stock-free container. Emulator/stress checks require separate native qualification and are not run by `npm run check`. Compiled module code, packaging parity and hardware qualification are separate proofs.

Displaced ColdFire module/platform expectations and DSP hook expectations were changed to address/length/hash guards. The receiver’s nine-word stock null routine is recovered and relocated only at local build time, never retained in the SDK source. `stock_guard.py` reads and verifies the developer's own ignored local extraction; absent or altered firmware fails closed. A copied stock-label table was removed. No stock firmware, extracted output, submodule checkout, vendor binary or upstream Git history is imported. The remaining native tooling/source needs a provenance audit before SDK release. `npm run sdk:check` covers guarded reads using original synthetic fixtures, with no firmware or emulator input. `docs/VERIFICATION.md` records native parity separately.

## Verify native composition locally

With a locally patched toolchain and your own ignored original 1.40C extraction:

```sh
python3 scripts/verify-sdk-native.py --raw-os /local/path/section_3_MAIN_OS.bin --vendor /local/path/vendor
```

The recorded verification used a temporary SDK copy, verified the original seven public modules and the internal loader, compares two complete native-image hashes and the overcrowding rejection, then removes the temporary firmware-containing outputs. It does not run audio renders, stress tests or the emulator. It produces proof of composition, not hardware qualification or a flashable download. This historical verifier deliberately copies only the original seven modules and registers their two loader platform declarations. The requested loader-free integration is verified separately by the 288-profile comparison below; it never enables the dynamic loader. The copied upstream Makefile remains a reference until portable SDK setup and local packaging are finished. See [verification.json](verification.json) for the recorded identities.

## Versions and approval

Publication requires actual hardware/emulator LCD captures of the selection/enable location and relevant controls, plus exact access steps and version/build/setup provenance in the manifest. See [the capture workflow](../docs/MODULE_UI_CAPTURES.md). Empty screenshots are draft-only; automatic USB modules without OT UI need the narrow reviewer-verified `access.noUiReason` declaration.

Every module has a semantic version. Code, native declarations, web descriptions, controls, evidence or media changes require a strictly greater version. Patch versions suit compatible fixes; minor versions suit compatible additions; major versions identify changed stored parameter layouts, IDs or behavior requiring migration. Never reuse an already released version for different contents.

**The owner merging the PR is the approval.** There is no second website approval step. Require owner review and passing checks on the current PR revision before merge. Automation builds the merged source commit and records module versions, source and artifact identities. A failed build keeps the previous release available. Protect main against unreviewed direct changes before enabling publication.

## Requested source imports

The utility release verifies every subset of the nine currently buildable frontend modules with both hidden and retained stock FX2: 1,024 profiles, 522 byte-identical MAIN OS images and 502 matching refusals. Eight complete native ELEK/ELUP upgrade identities also match. The actual browser worker builds both utilities; its downloads match the native full upgrades. No firmware enters the source-package compiler, application checks or repository.

```sh
node scripts/verify-utility-native.mjs /local/path/OCTATRACK_OS1.40C.bin src/engine/assets/utility-composition-proofs.json src/engine/assets/utility-packaging-proofs.json
```

The four earlier requested imports retain their approved publication and source pins. Historical comparison covered 288 requested profiles; the current verifier skips the pending MIDI Scenes update and compares the 144 buildable profiles. MIDI Scenes remains independently pending at `0.2.1-experimental`; it is not compiled or unlocked by this utility release. The release compiler covers twelve buildable catalog versions, binds the complete SDK source inventory and emits ten authored-source package artifacts. Inherited USB spans are zero placeholders; stock helpers and tables are derived only from the user’s fingerprinted local firmware. The importer and frontend-only stamp enforce versions, source identities and artifact scope. Owner merge remains publication approval.

With Node 24 and your own original firmware kept outside the repository:

```sh
node scripts/verify-requested-native.mjs /local/path/OCTATRACK_OS1.40C.bin src/engine/assets/requested-composition-proofs.json
```

See [verification](../docs/VERIFICATION.md) for full-file identities and coverage limits.

MIDI Scenes vendors only its twelve required GNU assembly units, README and MIT licence from 1.40MIDISC8.2. Quantizer vendors only its v2.9 implementation, documentation and MIT licence. Neither imports the other modules in its author's repository. USB MIDI source is under `octabam/platform/usb-midi/` and registered internally; it is not a public catalog entry. The chosen USB Audio module sends twenty output channels at high speed, with no USB audio input.

Import validation is static: `npm run sdk:check` checks the recorded source hashes, stock guards, author pins and required dependency files without evaluating imported Python. Every embedded stock expectation in the new declarations was replaced with an address/length/hash guard; no stock routines or firmware outputs were copied. Each TESTING.md separates upstream historical evidence from verified Octamod composition/packaging from remaining hardware qualification. No DSP execution, emulator, audio-render or stress suite runs in the browser build flow.

## OctaKit draft

[OctaKit](drafts/octakit/README.md) pins octabam `8d0ad6f4f82c2efbc10e1c65eefbce0ad1cec4bf` and June Kiff's MIT-licensed runtime at `c6d3f3927b13fda0cf03711157237b837acdb1f9`. [The import record](imports/octakit-8d0ad6f.json) binds each retained file to its exact source. The source subset contains the native declaration, upstream documentation/licences and runtime sources/local reconstruction recipe. Stock routines are recovered locally; compiled runtime blobs include stock and cannot enter automation or distribution.

The `0.1.1-experimental` draft includes an original SVG thumbnail, complete README/control reference/tutorial and three actual monochrome MKII LCD captures with local source/build/emulator/fixture provenance. It makes no qualification assertion. It does not appear in the configurator or saved selections. Publication requires worst-case cycles, exact memory regions/totals and owner-reviewed real-hardware test evidence tied to its version/source/local-image hashes, complete documentation/tutorial and real monochrome OT LCD PNGs, followed by owner verification and PR merge. Browser/native packaging, parity and rejection work is also pending. The frozen eleven-module baseline is unchanged. Static SDK/app checks verify source identities, documentation, capture provenance/monochrome pixels and that qualification still rejects the draft; they never execute its source. Follow [the standard agent workflow](../docs/MODULE_ADDITION_WORKFLOW.md) for future additions.
