# App development and operations

For module development, start with the [repository quickstart](../README.md) and [SDK guide](../sdk/README.md). Run commands below from the repository root.

A React / TypeScript web configurator for octabam, with a GitHub Pages frontend and a separate Cloudflare community API. Firmware stays on the user's device.

The frontend, backend and octabam-derived developer SDK belong in one repository. The owner may self-host the backend later; storage adapters for that option remain pending. See [architecture decisions](DECISIONS.md).

The configurator supports module discovery, filtering, comparisons and module sets, plus multiple named configurations with import/export. Module pages describe controls, compatibility, authorship and resource evidence. Keep first-time selection and build status clear, preserve the dark app design, and support mobile, touch and keyboard use across loading, empty, error and success states. Use “modules,” “module configuration” and “module set” in public copy; retain upstream command names where required for SDK compatibility.

The browser composes real firmware with the dynamic DSP loader disabled. **Downloads are available for verified loader-free selections**, including Analog BD, MIDI Scenes, USB Audio (tracks + MAIN/CUE) and Scale Quantizer at `0.1.1-experimental`. Spectrum, Modulation and Character remain temporarily paused in the public library. The original 256 profiles retain 74 byte-identical images and 182 matching refusals; the requested 288 profiles add 156 byte identities and 132 matching refusals. Actual-browser full-file identities and altered-firmware rejection passed for the supported six- and five-module combinations. Read [verification and remaining work](VERIFICATION.md) for evidence and hardware limits. Approved releases rebuild authored packages in isolation and require them to reproduce the locally verified packages.

## Preserve public firmware availability

Every visible module must support firmware generation and download in a compatible configuration. Pending updates stay on their branches; failed builds keep the approved deployment. Do not set the global download flag to false while an update awaits review. The public download policy regression test is part of `npm run check`; fix or isolate the pending change instead of weakening that check. MIDI Scenes remains standalone and ordinary compatibility/placement failures still explain how to fix a selection.

## Run locally

Use Node.js 24:

```sh
npm install
npm run check
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev:community
```

In a second terminal, run `npm run dev` and open http://127.0.0.1:5173. Vite proxies /api to the local Cloudflare runtime on port 8788, with D1 emulated locally. `.dev.vars` (ignored) sets the local `APP_URL` and overrides the production values in `wrangler.worker.jsonc`. Without the API, local configuration and firmware storage still work; community actions explain their unavailable state.

## Optional site support

The PayPal.Me destination is configured in `src/config/support.ts`. Set it to an empty string to hide the support entry.

A quiet “Support Octamod” entry with a small heart appears below the desktop sidebar’s privacy note and at the bottom of the mobile menu. It opens a personal note from the site maintainer, crediting the collaborative work of octabam, module authors and contributors, and explains that tips support site maintenance, module curation and community moderation. The visitor then chooses whether to open PayPal in a new tab. The site embeds no payment scripts and collects no donor information.

## Local workspace

Create, rename, edit, duplicate and delete multiple configurations. They save in IndexedDB and can be exported as JSON. Verified original OS 1.40C firmware is saved separately in this browser, reverified on restore and removable from the device. Firmware is never uploaded, synchronized, logged or included in configuration exports.

The verifier accepts the original 469,852-byte OCTATRACK_OS1.40C.bin with SHA-256:

```text
34695b606eb00e1b4dded5fd0c4b66f3a460522a632e47d7416dbd220599e1ad
```

Only this fingerprint is distributed. No stock firmware is included.

## Modules and compatibility

The catalog follows repeat98/octamad commit b8deefc88b2c3e5f3c6158e364eb741df1924e1d. Module links point to upstream sambanks/octabam; measurement links remain pinned to the fork revision.

Control descriptions and starting values are extracted from the pinned module manifests. native-metadata.json records lightweight declaration / ledger results for the 127 nonempty original-module selections and all 255 nonempty subsets of the eight visible modules, including native platform dependencies. Configuration does not run native stress tests, emulator gates or the octabam test suite.

These declaration checks do not prove final memory placement or hardware safety. The complete catalog is not hardware-qualified. Historical hardware records and emulator evidence are labelled separately. Tape Echo's pinned record specifically reports six instances working and a seventh freezing the unit.

The module-set browser includes four actual native test configurations from the pinned tree, with source links and historical evidence. Starting a configuration copies the selected modules. Chooser settings preserve stock effects by default; with stock FX2 kept, only Repitch can be built. Turn stock FX2 off to make room for other modules. All stock FX1 effects remain available, and selections that exceed the available space are refused.

Module thumbnails are original SVG illustrations. Module manifests now provide actual LCD captures and exact button/menu access steps. Capture/build provenance and rights review are required for new modules and updates; see [the workflow](MODULE_UI_CAPTURES.md). Actual licensed screenshots/audio belong in module source folders and are submitted through PRs. No real captures have been published yet; illustrations are not screenshots or measurements.

## Module source and versions

Spectrum, Modulation, Character, Mini Verb, Tape Echo, Euclid and Repitch are the original modules. The requested additions are Analog BD, MIDI Scenes, USB Audio (tracks + MAIN/CUE) and Scale Quantizer, with internal USB MIDI source. The four additions retain exact newer upstream pins and have renewed loader-free composition, packaging and rejection proofs. Source and website metadata live in `sdk/octabam/modules/<id>/`; the [SDK](../sdk/README.md) comes from a fresh, pinned, attributed octabam clone. The original platform integration passes native byte parity and has an approved source-build release pipeline; the four requested imports now use the same approval and reproducibility gates. See [the strict folder contract](MODULE_REPOSITORIES.md).

`octamod.module.json` schema 2 requires a semantic version, credits, descriptions, controls, compatibility, resource evidence, test provenance, licence and media declarations. `sdk/catalog.json` pins included versions; register each newly approved module’s first catalog inclusion date in `src/catalog/module-additions.ts` and retain that date through version updates for the Recently added sort. The existing dates come from catalog introduction commits `b16a5e3` and `98190bb`. `npm run modules:generate` derives the frontend catalog. `npm run modules:check -- --base origin/main` rejects any module-folder update without a greater version. PR CI validates against the exact base commit without executing native manifests.

Create a development skeleton with `npm run module:new -- my-filter --kind dsp --author your-github-login`, or `--kind coldfire`. A scaffold is untested and does not enter the configurator automatically. Read [CONTRIBUTING.md](../CONTRIBUTING.md) before implementation.

Saved configurations, duplicates and imported JSON backups automatically select the current catalog versions. Legacy saves also use current versions; supplied version metadata is still validated before replacing it. Exported JSON records the active versions, but importing an older backup updates its selection to the current catalog. Availability, compatibility and build-verification gates still apply, and every build validates the current selection. Firmware never enters an export. Configurations save on the device. Export moves a private backup to another device; the forum can publish an explicitly selected snapshot of module choices and versions. There is no automatic cloud synchronization.

## Community forum and accounts

Public discussions are readable without an account. Registration and verified email are required to open threads, reply, comment, rate, like or submit issues. Better Auth supplies password and session handling through a small server-side facade. Resend sends verification and recovery emails; the frontend never receives mail credentials. See [forum setup, local sample data, security controls and operational limits](FORUM.md).

The forum supports general discussion, module help, structured public bug reports and fixed configuration snapshots, plus search, bookmarks, reply notifications and protected moderation. Config snapshots contain only module metadata. Private reports on module pages stay visible only to their reporter and the administrator. Notifications are in-app; discussion replies do not send email.

Historical guest identities retain access to their private reports on the original device until their session expires or is replaced on sign-in. Names never transfer ownership to an account. New guest participation is closed. Administration continues to use its separate server-side key and tab session.

### Issue reports

Reports are structured, so authors can reproduce a problem across this many modules and configurations. Each report carries:

- a title, steps to reproduce, the expected result and the actual result;
- the Octatrack model and what it is running (an Octamod build, not flashed yet, or back on stock);
- the active configuration's module ids and versions, the FX2 chooser setting, the base OS and, when the image was built in this browser session, its SHA-256 (never the image itself);
- `OCTAMOD.LOG` from the card root, written by the on-device logger ([core logger](../sdk/runtime/logging/README.md)).

The form has three steps: describe the problem, check the browser configuration, and attach the device log. It explains stopping playback/recording, waiting for the checkpoint interval and saving, then USB DISK MODE or a card reader. Finder/File Explorer users can select OCTAMOD.LOG and OCTAMOD1.LOG from the top folder of the card. Files are checked locally; the complete one with the newest file date is selected, named and previewed before submission. After a crash, copy existing card logs; a power cycle does not guarantee recovery. The log is **required**. The only way around it is to tick “I can’t attach” and pick a reason that fits the report: the build has no logger, the unit does not boot, the card is unreadable, the problem happens before flashing, or another reason with a short explanation. Logging is mandatory core infrastructure, never a selectable catalog module. Older builds can use the explicit older-build reason; the Worker rejects “before flashing” when the reporter says the unit runs an Octamod build.

The browser and the Worker validate the log with the same strict parser (`src/community/ot-log.ts`, format in [FORMAT.md](../sdk/runtime/logging/FORMAT.md)). It accepts only printable ASCII in the OCTAMOD.LOG v1/v2 grammar (v2 also requires a completion CRC32), at most 64 KiB, so firmware, samples and project files are refused. Shared rules live in `src/community/issue-context.ts`.

New account reports, configuration context and logs are private to the reporter and administrator. The account draft does not create GitHub issues, even with `GITHUB_TOKEN` configured. `0013_issue_privacy.sql` grants no report public-sharing permission, including historical reports; GitHub retry is rejected for private records. Previously published reports retain their GitHub links and status synchronization. Re-enabling publication needs a separately reviewed consent workflow. Reports are capped at 60 per hour across the site, 10 per IP and 10 per member. Report copies are listed in Your account; there is no separate activity page.

Closing or reopening the GitHub issue updates the reporter's status through a signed `issues` webhook at `/api/github/webhook`, verified with `GITHUB_WEBHOOK_SECRET` and the configured repository. Resolving a report in the admin inbox also closes or reopens the GitHub issue. The admin inbox shows the context, a log summary, a log download and any existing GitHub link. Reports, contexts and logs are also kept in D1.

## PR approval and administration

Modules, code updates, documentation and media are submitted through GitHub PRs only. **The owner merging the PR is approval** for that version. There is no second website approval step. Require owner review and successful checks on the latest revision, protect main and never reuse a released version for changed contents. Pending PRs and failed release builds retain the previous publication.

Module manifests import plain-text descriptions, controls, evidence and rights metadata from source folders. `.github/workflows/pages.yml` compiles each owner-merged main commit in a container without network, credentials or stock firmware, mounting only the tracked tree of that one commit. The publisher independently confirms the owner merge through the GitHub API (configured numeric `MODULE_APPROVER_GITHUB_ID`), current versions, the complete source inventory, the compiler and all nine artifact hashes. It publishes only if the build reproduces the committed packages, which were checked locally for native parity. Metadata generation alone cannot install arbitrary modules. See `docs/VERIFICATION.md` for what has and has not run.

The website contribution route provides SDK/PR instructions and uses `VITE_REPOSITORY_URL` for the actual repository links. Until a repository is configured, it clearly says the repository is being prepared. The former submission, repository-import and website-review API routes return 410. Existing database publication/history records and media reads remain for migration; no new version can bypass PR approval.

The private administrator workspace provides GitHub contribution entry points, published-record withdrawal, comment moderation, the issue inbox (with private logs and existing GitHub status) and history. Administration is separate from member participation: the backend owner configures `ADMIN_KEY_SHA256` (the SHA-256 of a random key from `npm run admin:key`), and the administrator exchanges that key for an eight-hour session kept only in the current tab. Every `/api/admin/` route checks it on the server; without a configured key the workspace stays closed. Rotating the key revokes all administrator sessions. A provider-specific gate such as Cloudflare Access can replace this during backend setup. Reviewer checks must cover behavior, evidence, resources, authorship, licences and original/media rights; review is not automatic legal clearance.

## GitHub Pages and community API setup

`.github/workflows/pages.yml` runs for every push to main (and on manual dispatch). It verifies the owner merge. When module source, the compiler, the release scripts or the committed packages changed since the last successful release, it compiles modules in isolation and requires them to reproduce the committed packages. Frontend-only releases skip that compile; they confirm that the committed packages still match the module source fingerprint and compiler they were verified with. Every release then checks the app with Node 24, builds static files and publishes `dist/` to GitHub Pages. Direct pushes without an owner-merged PR fail before anything is built. Actions, the runner image and the toolchain base image are pinned to exact versions; the container builds GNU binutils 2.47 for `m68k-elf` from the checksum-pinned official release, the same toolchain that produced the committed packages. Relative asset paths and hash navigation support repository URLs such as `https://<owner>.github.io/<repo>/` and root/custom-domain URLs. The site is published at https://octamod.app. The SDK belongs in this same repository; see [accepted decisions](DECISIONS.md).

The community runs separately through `worker.ts` and `wrangler.worker.jsonc`, initially using Cloudflare Worker and D1 free allowances. The account addition requires checking scrypt CPU/memory against the chosen plan before launch. The production API is `https://octamod-community.octamod.workers.dev/api`. Module screenshots and audio arrive through PRs and are served by the site, so no R2 bucket is bound; the read-only legacy media route stays inert without one. Better Auth is open source; Resend has a free sending tier. Hosting and sending limits still apply; free production capacity has not been established for the new account workload. The frontend uses the public `VITE_COMMUNITY_API_URL` ending in `/api`; leave it blank for the local Vite proxy. Only JSON, original/licensed preview media and community session data reach the API. No firmware endpoint exists.

Production setup (completed 1 October 2026; repeat these steps for another environment):

1. Enable GitHub Pages with GitHub Actions as its publishing source and protect `main` (required PR, owner review, required checks; no merge queue, which would change the merging account). Set the repository variables `MODULE_APPROVER_GITHUB_ID` to the owner's numeric GitHub user ID (`gh api users/<login> --jq .id`) and `COMMUNITY_API_URL` to the deployed backend URL ending in `/api`. For a custom domain, verify it for Pages and set it in the Pages settings; with Actions publishing no `CNAME` file is needed.
2. Create a D1 database with `npx wrangler d1 create octamod-community`, put its ID in `wrangler.worker.jsonc` and apply all current migrations with `npx wrangler d1 migrations apply octamod-community --config wrangler.worker.jsonc --remote`.
3. Set `APP_URL` in `wrangler.worker.jsonc` to the full frontend URL with its trailing slash (`https://octamod.app/`; include the repository path for a `github.io` project URL). Keep `SESSION_TRANSPORT=bearer` for separate domains.
4. Run `npm run admin:key` locally. Keep the printed key in a password manager and store only its digest as the Worker secret `ADMIN_KEY_SHA256`; never as a frontend `VITE_` value.
5. The pending account draft does not grant public sharing or create GitHub issues. To retain status synchronization for previously published issues, enable Issues on the repository and create a fine-grained personal access token limited to that repository with **Issues: read and write**. Store it as the Worker secret `GITHUB_TOKEN` (`npx wrangler secret put GITHUB_TOKEN --config wrangler.worker.jsonc`); set `GITHUB_REPOSITORY` only if it differs from `repeat98/octamod`. Then add a repository webhook: payload URL `<community API>/github/webhook`, content type `application/json`, a random secret stored as the Worker secret `GITHUB_WEBHOOK_SECRET`, and only the **Issues** event. Without the token, reports stay in the admin inbox only.
6. Deploy the Worker with `npx wrangler deploy --config wrangler.worker.jsonc` (or `npm run deploy`), then run the frontend workflow so the site is rebuilt with `COMMUNITY_API_URL`. Publishing the frontend never approves a module update.

Cross-origin requests do not depend on third-party cookies. Account sessions are signed tokens saved on the frontend origin and sent in an `Authorization` header; administrator sessions use a separate `X-Octamod-Admin` header and tab-scoped storage. CORS allows only the configured frontend origin and exposes only the session response header. No session token appears in a URL. All GitHub Pages sites of one account share the `<owner>.github.io` origin, so use a custom domain or a dedicated account/organization if other Pages sites live there.

The owner may instead host the backend on their own webserver. `server/platform.ts` defines the database and object-store adapter interfaces; a self-hosted HTTP entry point, SQLite adapter and filesystem/object-storage adapter remain to be implemented. Only the frontend's API URL would change; local firmware processing would remain identical. A self-hosted backend must derive the client IP for rate limits from its trusted reverse proxy instead of `CF-Connecting-IP`. Same-origin Cloudflare Pages remains a fallback via `wrangler.jsonc`, the existing Pages Function and `npm run deploy:pages`.

`.dev.vars.example` documents local variables; `.dev.vars` is ignored. Deployment still requires the owner's authorization. GitHub repository ownership is public for a free public Pages repository; a branded URL does not hide that ownership.

## Firmware engine status

The worker verifies the selected base fingerprint, decodes its ELUP update wrapper and ELEK container, and validates / decompresses its OS section locally. The aPLib-compatible compressor retains the native tool's chain order, offset reuse and strict cost-tie handling. Container rebuilding preserves the user's header and opaque tail, stamps the version field, repacks the OS section, and verifies the complete update round-trip. None of these codecs contain firmware content.

Eight synthetic packing cases match the native C implementation byte for byte, covering literal bytes, repeated offsets, overlapping copies, long lengths, incompressible input and far-offset length bonuses. The original user-supplied 1.40C OS section decodes identically to both the native codec and the existing native extraction (1,112,560 bytes). Only synthetic oracle vectors and fingerprints are retained in the app. The native-derived tests run without the native toolchain. Reproduce the independent comparison with Node 24 and a C compiler:

```bash
node scripts/verify-codec-native.mjs /path/to/octamad-worktree /path/to/your/OCTATRACK_OS1.40C.bin
```

The stock-file argument is optional. This command compiles a small codec oracle in a temporary directory, compares synthetic packing vectors, optionally compares local stock decoding, and cleans up. It does not run firmware stress tests or emulators and does not write firmware files.

Five independently authored DSP packages (Spectrum, Modulation, Mini Verb, Euclid and Tape Echo’s passthrough shim) have native exports with source fingerprints, attribution, checksums and relocation records. The browser relocator matches fresh native assembly at four origins for each package. Character uses a separate resident / selection-dependent path and is excluded from the loadable package format; the resident composer below handles the native default layout. Tape Echo and Euclid also require their ColdFire units; Repitch is a ColdFire contribution. The DSP package export is not sufficient to build those modules.

Reproduce the package export inside the owned native worktree, with the pinned toolchain available:

```bash
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-dsp-packages.py /path/to/octamad-worktree /tmp/dsp-packages.json
```

This invokes assembly / disassembly and the native four-origin relocation proof. It reads module source, not stock firmware, and runs no emulator or stress tests. The generated records contain only independently authored code and tables.

The worker also recovers both stock DSP record maps, 26 stock effect packages and six shared-routine copies from the user's local OS section. Only source offsets, record layouts, fingerprints and signed address adjustments are retained in stock-dsp-metadata.json; it contains no stock instruction words. Recovery verifies the original OS and every source / transformed span. Stock packages support both positive and negative relocation tags, and DSP writes preflight the full range before changing record data.

The original 1.40C record order is `[space, address, count]`, with each field a little-endian 24-bit word. Cross-record reads and writes preserve the intervening record headers. The native comparison checks 78 relocated-package fingerprints and rejects modified input:

```bash
node scripts/verify-stock-dsp-native.mjs /path/to/your/OCTATRACK_OS1.40C.bin
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-stock-dsp-metadata.py /path/to/octamad-worktree /tmp/stock-dsp-metadata.json
```

Both commands stay local. The exporter reads native source and the native worktree's user-supplied stock extraction, and emits metadata only. The verifier retains no firmware files and runs no emulator or stress tests.

The ColdFire object reader accepts bounded ELF32 big-endian m68k objects and applies absolute / PC-relative relocations at explicit section addresses. Two synthetic fixtures match GNU linking at low and DRAM addresses, including weak symbols and zero-fill sections. Malformed files, missing symbols, overflow and implicit merge layouts are rejected. The runtime linker below builds on this reader; ELF parsing alone does not enable firmware download. Regenerate its fixtures without reading firmware:

```bash
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-coldfire-elf-oracles.py /path/to/octamad-worktree /tmp/coldfire-elf-oracles.json
```

The browser can serialize the native runtime catalog: 32 admission descriptors, the two-core code table, correctly aligned package words, signed relocation records, boot-stub flags and buffer-read flags. Its four synthetic fixtures match the native assembler's bytes and symbol addresses. The independent local comparison also matches five real-stock catalogs, including the full seven-module selection and reordered input. Only fingerprints and symbol addresses from those stock-containing results are retained in the app.

```bash
node scripts/verify-runtime-catalog-native.mjs /path/to/your/OCTATRACK_OS1.40C.bin
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-runtime-catalog-oracles.py /path/to/octamad-worktree /tmp/catalog-oracles
```

The factory reports the resident / ColdFire paths still required by Character, Tape Echo, Euclid and Repitch. It does not claim those modules are fully composed just because their catalog is serializable.

Eleven independently authored DRAM objects from the pinned platform, Euclid and Tape Echo sources are now bundled with attribution and checksums. The browser runtime linker implements the measured GNU section layout, NOP text padding, merged and suffix-shared strings, data alignment and page optimization. Five firmware-free synthetic catalog links match native bytes, global symbols and nonempty output sections. The factory orders selected units as the native registry does, then creates the catalog from locally recovered stock DSP packages.

Runtime compression uses the native greedy GKA3 encoder, independently of the stock section's cost-based parser. Eight synthetic packing cases match native streams, including a 32,768-byte overlapping match, offset reuse and a distant match; six native loader appends match byte for byte. The early loader is an authored relocatable template, with per-build source pointer, raw length, packed and raw rolling hashes, uncached stage / destination addresses and payload bytes. The runtime and packed stage must fit the native reserved sample-memory extent. June Kiff's Octakit MIT license and octabam's MIT license accompany the port.

Platform OS writes use fingerprints as guards, never bundled stock bytes. The installer preflights all addresses and overlapping ranges, verifies the original OS and every guard, then writes to a copy. It installs 28 arena words, the boot redirect and the platform / selected Tape Echo and Euclid detours. Missing, odd or non-code symbol targets and modified source images are rejected. These are partial composition writes: Repitch ROM placement, descriptor formatters, menus and DSP installation are not supplied by this installer.

Eight actual stock-derived runtimes, including the full seven-module selection and reordered input, match native runtime bytes, global symbols, output section extents, complete packed loader append and the partial OS after these platform writes. The verifier reads the user's file into memory and retains no generated firmware. Regenerate or check these proofs locally:

```bash
node scripts/verify-coldfire-runtime-native.mjs /path/to/your/OCTATRACK_OS1.40C.bin
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-coldfire-packages.py /path/to/octamad-worktree /tmp/coldfire-packages
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-runtime-loader.py /path/to/octamad-worktree /tmp/runtime-loader --app /path/to/octamod
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-coldfire-runtime-proofs.py /path/to/octamad-worktree /tmp/runtime-proofs.json
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-platform-writes.py /path/to/octamad-worktree /tmp/platform-writes.json --app /path/to/octamod
```

The runtime / platform exporters retain only identities, symbol addresses, layout and write metadata from stock-derived outputs; temporary native files are removed. The package / loader exporters read authored sources and synthetic inputs only. None runs emulator or stress gates, invokes submitted repository code or alters the native build.

The browser also composes both resident DSP payloads for the native default stock FX1 chooser. It recovers the six shared stock routines, places Character with its shared-bus address rewrite when selected, allocates the receiver's table / code extents, installs both frame hooks and initializes managed dispatch entries to the original null routines. The receiver template omits its nine copied stock-stub words: those are recovered from the user's OS, address-adjusted and fingerprint-verified locally. Character matches native assembly at four origins; both complete payloads match the unmodified native builder for four selections, including the full seven modules. Originals, record headers and trailers are preserved. Modified payloads / shared routines and duplicate cores are rejected.

This resident profile preserves DJ EQ on the default stock FX1 chooser, so its live curve bank keeps Character's table in P memory. Custom choosers that release that bank require the native X-table placement profile before they can use this composer.

Descriptor recipes contain authored labels and numeric field patches, plus donor / destination guards. The composer copies each selected donor locally, sets its id, names, defaults, counts, enable / link masks and baseline stepped / bipolar renderer fields, and installs its FX2 descriptor pointer. All six module descriptors match snapshots from the unmodified native builder before caves / dynamic formatters. Names must leave room for a terminator, clones stay inside the reserved window, and plans merge with the DSP payload writes without overlap. No donor descriptor content is bundled. Reproduce these additional proofs:

```bash
node scripts/verify-resident-dsp-native.mjs /path/to/your/OCTATRACK_OS1.40C.bin
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-resident-dsp.py /path/to/octamad-worktree /tmp/resident-dsp.json --app /path/to/octamod
```

The exporter runs the unmodified native composition function in disposable output trees to measure complete DSP payloads and baseline descriptors. It records fingerprints only from the resulting images, deletes temporary stock-containing files and disables native runtime caching for these runs. It runs no emulator, render or stress gates.

The module menu composer now places Repitch’s authored ROM unit and guarded detours / pointers / count changes, Spectrum’s pinned SHPE formatter with its clone reference, Tape Echo’s time formatter, all twelve labelled selects and mode-dependent knob names, and the shared wide dial hook. Every mode restores all names touched by any mode. ROM objects match native linking at four origins; label recipes match the native emitters and their assembler verification at two descriptor origins. Wide dial tables match native assembly with one and three rows. Unsafe format strings, invalid names / references / rows and unsupported allocated sections are rejected.

Four disposable native compositions provide complete fingerprints for every resulting descriptor, authored ROM / formatter region and affected stock patch site. The local verifier matches all of them, including the crowded seven-module selection and overflow placement; it also combines their write plans with the DSP and runtime platform plans to prove guards and non-overlap, preserving the original input. No stock site bytes or descriptor donors are exported. Reproduce the menu proofs with:

```bash
node scripts/verify-module-menus-native.mjs /path/to/your/OCTATRACK_OS1.40C.bin
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-module-menus.py /path/to/octamad-worktree /tmp/module-menu-assets --app /path/to/octamod
```

The retained dynamic-loader composition path adds the FX1 / FX2 chooser lists, descriptor and cursor tables, viewport sizes and all list references, then combines these with the resident DSP payloads, authored menu / ROM code, runtime platform patches and appended boot loader. Defaults preserve every stock effect, put Spectrum / Modulation / Character on FX1, keep Mini Verb and CPU Tape Echo on FX2, and offer Euclid on both. A compact FX2 chooser is also representable while retaining the stock FX1 list. Duplicate / missing effects and wrong-slot selections are rejected. The all-seven-module selection with every stock FX2 row exceeds native menu capacity; both composers reject it without changing the original image.

Eight complete OS images, including stock-preserving and compact chooser profiles, match the unmodified native builder byte for byte. Packaging identities use the same original card `.bin` as the app: a temporary C oracle calls the native firmware tool’s unchanged ELEK rebuild / version functions, then the native ELUP wrapper. The original card and SysEx containers have different trailing padding; comparing against a different stock transport is not a same-input packaging proof. Only source identities, format facts and output fingerprints are retained. The exporter removes temporary stock containers and images. Reproduce the complete comparisons with:

```bash
node scripts/verify-composition-native.mjs /path/to/your/OCTATRACK_OS1.40C.bin
/path/to/octamad-worktree/.venv/bin/python3 scripts/export-composition-proofs.py /path/to/octamad-worktree /tmp/composition-assets --app /path/to/octamod --stock-bin /path/to/your/OCTATRACK_OS1.40C.bin
```

The historical dynamic-loader same-input packaging comparison passed for all eight profiles, including complete OS, ELEK container and flashable ELUP bytes; rerun it before enabling that path again. The actual browser worker also matched native full-file identities for two supported configurations, rejected overflowing stock-preserving placement, and supported cancellation/rebuild and download invalidation. Downloads are enabled for verified selections. The active loader-free path keeps stock DSP code resident, places selected modules in the space of stock effects omitted from both menus and adds a sample-memory runtime when Tape Echo, Euclid or a requested runtime module is selected. Visitor builds omit only the FX2-only reverbs whose code the selection needs (`stockFx2Donors` in `src/engine/static-dsp.ts`): the fewest, Spring first, then Plate and Dark. DARK REV calls a 35-word routine at SPRING REV+820 and PLATE REV a 93-word routine at DARK REV+974, so a reverb is only given up alone when placed code stops before a routine that a kept reverb calls; `composeStaticDsp` refuses any profile that would overwrite one. Analog BD always takes SPRING REV and moves DARK REV's routine itself. When the longer stock-retaining FX2 list leaves the module menus too little room, `composeSelection` uses the compact FX2 menu. All 256 supported selection profiles have native composition/refusal proofs and every accepted profile has native packaging fingerprints. Verify all OS/refusal cases plus representative full files locally with:

```bash
node scripts/verify-static-composition-native.mjs /path/to/your/OCTATRACK_OS1.40C.bin --packing=representative
```

Verify the requested selection matrix independently with:

```bash
node scripts/verify-requested-native.mjs /path/to/your/OCTATRACK_OS1.40C.bin src/engine/assets/requested-composition-proofs.json
```

Omit the static verifier’s final option for exhaustive original-profile full-file comparisons. Only identities and format facts are committed; the user's firmware and generated images stay local. Custom choosers that free the stock curve bank still require a separate X-table placement profile and are not offered by this UI.

Keep download enabled only while real composition and native byte-parity/rejection evidence match the shipped catalog and engine. Keep packaging and conflict checks in the user build; do not run the full octabam test suite per configuration.

Stock and generated firmware must remain local. Never ship prebuilt images, stock slices, decoded routines, tables, or generated JS/WASM containing stock content. Own compiled module code may be shipped with attribution; stock content must be derived at runtime from the user's file.

## Source layout

```text
src/catalog/      provenance, native declaration checks, controls and resources
src/config/       configuration data and exports
src/storage/      browser-only configuration and firmware persistence
src/engine/       local worker, base verifier and update codec
src/community/    forum, accounts, PR guide, private reports and administration
server/           community HTTP contract, email accounts and administrator access checks
functions/        Cloudflare Pages entrypoint
migrations/       D1 schema
public/_headers   Cloudflare fallback security headers; no analytics or third-party fonts
public/licenses/  licenses for adapted source and documentation
sdk/              pinned native source, eleven module folders, internal dependencies, templates and SDK guide
```

`npm run check` runs lint, small domain / API tests, type checks and a production build. API tests use an in-memory SQLite database and synthetic media, never real firmware. Native emulator, stress and audio-render checks require separate qualification and are not part of this command or the configuration flow.

Checks first validate licence-notice and catalog freshness, then finish notice/catalog/media generation before readers start. SDK checks, lint, tests and the production build run concurrently, and every stage must pass; type errors prevent bundling. Test files retain isolation and use up to four workers, including the release tests under `scripts/`. ESLint caches results by file contents and configuration under `node_modules/.cache/eslint/`; TypeScript keeps incremental app, tooling and server state under `node_modules/.tmp/`. Licence and catalog/qualification validation, SDK checks, all tests and production bundling still run every time. `npm run typecheck` checks all three TypeScript projects, and `npm run lint -- --no-cache` performs an uncached lint run.

Successful reports open the returned GitHub issue in a new tab and retain a fallback link. The server mentions the catalog author. If GitHub forwarding fails, the saved-report confirmation asks users not to submit duplicates.
