# App development and operations

The independent API/backend is source available under Elastic-2.0; the browser
frontend remains GPL-3.0-or-later. Read [platform licensing](PLATFORM_LICENSING.md)
for the scope and dependency boundary before sharing code between them.

Existing published module authors may use the [automatic author-update workflow](MODULE_AUTHOR_UPDATES.md): verified ownership, changes confined to their modules, explicit evidence review and successful checks on the exact source/base permit bot merge and publication. Other changes retain owner review. Existing qualification gates and exact-version owner exceptions are unchanged.

For module development, start with the [repository quickstart](../README.md) and [SDK guide](../sdk/README.md). Run commands below from the repository root.

A React / TypeScript web configurator for octabam, with a GitHub Pages frontend and a separate Cloudflare community API. Firmware stays on the user's device.

The frontend, backend and octabam-derived developer SDK belong in one repository. The owner may self-host the backend later; storage adapters for that option remain pending. See [architecture decisions](DECISIONS.md).

The configurator supports module discovery, filtering, comparisons and module sets, plus multiple named configurations with import/export. Module pages describe controls, compatibility, authorship and resource evidence. Keep first-time selection and build status clear, preserve the dark app design, and support mobile, touch and keyboard use across loading, empty, error and success states. Use “modules,” “module configuration” and “module set” in public copy; retain upstream command names where required for SDK compatibility.

The browser composes real firmware with the dynamic DSP loader disabled. **Downloads are available for verified loader-free selections**, including Analog BD, MIDI Scenes, USB Audio (tracks + MAIN/CUE) and Scale Quantizer at `0.1.1-experimental`. Spectrum, Modulation and Character remain temporarily paused in the public library. The original 256 profiles retain 74 byte-identical images and 182 matching refusals; the requested 288 profiles add 156 byte identities and 132 matching refusals. Actual-browser full-file identities and altered-firmware rejection passed for the supported six- and five-module combinations. Read [verification and remaining work](VERIFICATION.md) for evidence and hardware limits. Approved releases rebuild authored packages in isolation and require them to reproduce the locally verified packages.

Air Chorus 0.1.1 is available to the **Beta tester** class and verified administrators, with a **Beta** badge on its card and page. Ordinary members and visitors retain the pause. Beta membership is an independent, administrator-managed flag, alongside existing member/developer/owner roles; it grants no moderation, ownership or author-release permissions. Manage it in **Admin → Accounts → Beta testers**. Server sessions provide the flag, build authorization rechecks it, and revocation invalidates the frontend build state. Browser source/packages remain inspectable; this is an access workflow, not secrecy or firmware DRM.

MIDI Scenes is temporarily paused at the owner's request (11 October 2026, no cause recorded). The existing frontend pause hides it from the library, sitemap and release inventory and blocks new builds that select it. Saved configurations stay readable and name it for removal. Its source, catalog pin and release notes are untouched, and its release-state row survives, so removing `midi-scenes` from `PAUSED_MODULE_IDS` restores it without a new-module announcement.

The owner authorized beta publication of the staged DSP optimization on 9 October 2026 and waived current hardware evidence for its exact 0.1.1 source. Measured DSP work is reduced, but the T3/T4 clicking report remains unconfirmed. The module page and release notes retain that limitation. Other paused effects stay paused, public indexing omits beta modules, and the deployed release inventory labels beta versions. Update notifications go only to eligible beta followers/administrators, preserving opt-outs; beta releases create no public release announcement.

## Preserve public firmware availability

Every visible module must support firmware generation and download in a compatible configuration. Pending updates stay on their branches; failed builds keep the approved deployment. Do not set the global download flag to false while an update awaits review. The public download policy regression test is part of `npm run check`; fix or isolate the pending change instead of weakening that check. MIDI Scenes remains standalone and ordinary compatibility/placement failures still explain how to fix a selection.

## Browsing module results

### External project directory

`/projects/` is the **Other projects** directory, linked from the desktop sidebar,
phone menu and instrument libraries. It lists independent mods, tools, emulators
and developer tools that use their own workflows outside Modwerk. Entries have creator
credits, repository links, instrument tags and original short summaries; they
never enter firmware selections, module releases or module notifications.

Maintain the curated list in `src/projects/projects.ts`. Check repository links
and keep current versions, detailed installation and support requirements in the
upstream project. Instrument tags aid discovery and do not certify every model
or OS. Individual modules already offered by Modwerk belong in the module
library; upstream collections may remain here with their relationship explained.
Search combines with instrument and project-type filters. Instrument links can
prefilter the directory with `?machine=<family-id>`. The production build emits
the full link directory as readable HTML, with its own canonical URL, social
card and sitemap entry. “Want me to add your project?” opens the existing support
email address with a prefilled project-submission draft. The sidebar and mobile
menu temporarily mark the directory as New. Selection criteria and independently
researched additions are recorded in [the curation notes](EXTERNAL_PROJECTS.md).

Card thumbnails are cached GitHub repository Open Graph images, including each
repository's custom sharing artwork when provided. Refresh them with
`node scripts/project-thumbnails.mjs --refresh` under Node 24; this maintenance command
requires network access. It records source URLs, fetch dates, dimensions and
hashes in `src/projects/thumbnails.json`. Images are resized without cropping
and served locally, preserving the existing image policy and avoiding visitor
requests to GitHub. Creator credits and directory-source attribution remain
visible. Octatrack Manager uses its README screenshot; Octobus Additions uses
its creator's GitHub image because the layout has no cover. These previews are
upstream promotional images, not Modwerk validation
or proof of compatibility. The directory's own Modwerk sharing card is separate;
see [social-preview artwork](SOCIAL-PREVIEW.md#other-projects-directory).
Omit `--refresh` to resume missing previews after a transient download failure.

### Module navigation

On desktop (above 1100px), module detail pages offer left and right chevrons and Left/Right arrow keys to move through the catalog results that were visible when a module was opened. The result order includes the selected machine, category, search, type and sort; All machines continues across machine groups in their displayed order. Paging stops at each end. “Back to results” restores the same filters. The last result selection stays in this tab's session storage so refreshing a module page keeps the context; unavailable storage still permits paging during the visit. Direct pages outside that result selection keep their usual library link.

Inputs, tab lists, menus, media controls and open dialogs retain their arrow-key behavior. Phones and smaller layouts retain the normal module page without side chevrons or global arrow-key navigation.

## Run locally

The shared dark palette is defined by the semantic colour tokens at the top of
`src/styles.css`. Use those tokens for neutral surfaces, text, control borders
and interaction states in the library, forum, device pages and dialogs. Keep
module illustrations and success/warning colours distinct. Secondary text must
remain readable on hover surfaces; primary buttons use dark text on lavender.
Keep panel edges quiet and use filled surfaces for separation; reserve bright
outlines for focus. Native selects share the chevron token with a 14px edge inset
and 42px right padding, including in dialogs and phone layouts.
When changing the palette, inspect rendered pages and keyboard focus at phone,
tablet and desktop widths, and measure text contrast against the actual surface.

Use Node.js 24:

```sh
npm install
npm run check
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev:community
```

In a second terminal, run `npm run dev` and open http://127.0.0.1:5173. Vite proxies /api to the local Cloudflare runtime on port 8788, with D1 emulated locally. `.dev.vars` (ignored) sets the local `APP_URL` and overrides the production values in `wrangler.worker.jsonc`. Without the API, local configuration and firmware storage still work; community actions explain their unavailable state.

## Search indexing

The production build includes HTML summaries: the homepage links to available modules on all three supported machines, module pages use their current catalogue documentation, and `/submit/` describes the shared developer workflow. Public forum pages include their existing public excerpt. A small same-origin, parser-blocking script in the head hides these summaries before the body can paint, preventing a text flash while React loads. React replaces them with the interactive app. With JavaScript disabled, or if the app script fails to load or execute before mounting, the summaries remain readable. Firmware and private account/report data are never prerender inputs.

Octatrack modules use `/module/<slug>/`; Digitakt and Digitone modules use `/<machine>/module/<id>/`. Old module hash links still open and are normalized to public paths. Direct pages carry one canonical URL, a descriptive instrument-specific title, descriptions and share cards. Client navigation updates the page metadata as well. Library filters, configurations and account views retain their existing hash navigation.

`scripts/seo.ts` runs after the page generators and emits `/sitemap.xml` from canonical HTML pages actually present in the build. It deduplicates aliases and omits paused modules, noindex/404 pages, query strings, fragments and profiles without static pages. `/robots.txt` advertises this same-origin sitemap. The site still builds without the community API; only successfully fetched public thread pages enter that build's sitemap. For a Pages project path, all URLs keep the configured base. After deployment, submit the sitemap in the site's verified Google Search Console property and inspect representative homepage/module URLs; indexing and rankings depend on the search engine.

For the local post-download check-in preview, open `http://127.0.0.1:5173/?preview=firmware-feedback`. Add `&guide-machine=digitakt` for Digi Mono, Digi utilities and the longer Digi guides. It opens the modal immediately; **Simulate download · 2 s** demonstrates a delayed check-in. The production check-in opens after every download, including repeat downloads, after two seconds, when the tab is visible and no other dialog or editor is active. The preview exercises the same scheduler with a disposable local fixture.

The overview shows exact downloaded versions, sidebar thumbnails and real version-matched captures: two together on desktop, one below 1051px or when enlarged. Labeled 44px Previous/Next buttons and Left/Right, Home/End keys navigate only within the focused carousel. Its count announces the visible range; enlargement and Escape restore focus to the capture. Nothing rotates automatically. Short, titled quick tests are shared with module pages; full instructions, additional controls, setup steps and screenshot credits remain expandable. Screenshot paging, enlargement and the flashing guide stay in the same overlay. **Open module guide** reopens it from the download panel. It includes one-click per-module working confirmations, the real issue-report form with local submissions and dismiss/snooze choices. Preview actions never download firmware or send reports. Only the disposable fixture’s reminder state is stored locally and removed on leaving the preview. The preview is available only in Vite development mode.

Open `http://127.0.0.1:5173/?preview=reporting` to compare the module-page feedback card, download follow-up, return reminder, delayed modal and Octatrack/Digi issue forms side by side. The preview reuses the real reporting components with a local fixture member; working confirmations and report submissions stay local and do not create hardware claims or notifications. `?preview=reporting-module#module/fm-synth` shows the actual module-page layout with the same local-only reporting actions. Production builds omit the preview entry points and retain the real check-in.

Reporting actions share the neutral **Works for me** button (plus before submission, green check and **Reported working** after success) and amber **Report an issue** button. Download follow-ups and return reminders offer these actions directly on each module; bulk confirmation is optional and never preselects companions. Downloaded builds carry their original versions. Digi reports with a known model and OS keep those prefilled fields under **More details**, where the reporter can correct them. The release-follow checkbox stays a horizontal row in inline forms and dialogs.

Module-page working buttons restore the signed-in member’s confirmation across navigation, reloads and devices. They become available again for a new module version; the distinct-member count across versions stays intact. A quick confirmation without a matching current download records the displayed catalog version only as button state, while the installed firmware version remains unknown. Existing quick confirmations recover that state from the deployed release history at their original save time.

## Audio playback

`src/components/AudioPlayer.tsx` supplies WaveSurfer waveforms and shared controls
for community cards, forum attachments, upload previews, module galleries and the
downloaded firmware guide. Use it for new audio surfaces. Only one clip plays at
a time across the site; navigating away releases playback and the waveform.
The library and audio decoding load when a player becomes visible, or when the
visitor presses Play. Waveforms use the actual audio, decoded at 8 kHz for display;
playback retains the file's original quality. Hovering shows the seek timestamp.
Native range controls support touch
and keyboard seeking (arrows skip five seconds, Shift skips ten, Home/End go to
the start/end). Loading or decoding failures keep playback controls available.
Private media still uses the existing authenticated blob fetch and URL cleanup.
WaveSurfer's full BSD notice is included by `npm run licenses:generate`.

## Optional site support

The Ko-fi page is configured in `src/config/support.ts`. Set it to an empty string to hide the support entry.

A quiet “Support Octamod” entry with a small heart appears below the desktop sidebar’s privacy note and at the bottom of the mobile menu. It opens a personal note from the site maintainer, crediting the collaborative work of octabam, module authors and contributors, and explains that tips support site maintenance, module curation and community moderation. The visitor then chooses whether to open Ko-fi in a new tab. This site-support flow embeds no payment scripts and collects no donor information. Opening the dialog and clicking its Ko-fi button, or a bell entry that links to Ko-fi, are counted as site statistics like page views (see [STATISTICS.md](STATISTICS.md)); nothing about the tip itself reaches Modwerk.

## Module creator support

Users who create modules can add their own Ko-fi support links. Verify the developer account with GitHub from **Your account → Developer account**, claim a module associated with that reviewed author/maintainer identity, then save its HTTPS profile URL in **Creator settings → Your Ko-fi page**. The same current maintainer can edit or remove the link on the module page. Links are optional and stored per module (machine-qualified for Digitakt/Digitone); a forum display name alone does not grant editing rights. Verified owners of legacy published contributions can manage their own links too. See [developer ownership and setup](DEVELOPER_WORKSPACE.md).

A small cup icon beside the creator name opens Ko-fi's embedded tip panel in a dialog. Load the iframe only after the visitor clicks; retain the close/Escape controls, focus restoration and direct-link fallback. Ko-fi handles tips and payment details. The production HTML policy in `vite.config.ts` and the hosting policy in `public/_headers` must both allow `https://ko-fi.com` in `frame-src`; a successful Vite development preview alone does not verify this. The owner default comes from `src/config/support.ts` for reviewed `repeat98` authors, while saved links and explicit removals override it. Revoked or suspended maintainers' saved links are hidden.

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

`octamod.module.json` schema 2 requires a semantic version, credits, descriptions, controls, compatibility, resource evidence, test provenance, licence and media declarations. `sdk/catalog.json` pins included versions; each entry's `addedAt` records when the module first entered the catalog and is kept through version updates for the Recently added sort. The existing dates come from catalog introduction commits `b16a5e3` and `98190bb`. The default Recently updated sort uses the later of first inclusion and the exact published version’s date in `src/community/module-changelogs.json`, so both initial releases and version updates rise in the library. This uses the required release notes for every machine; no separate release-date registry needs maintaining. Reviewed community modules use their latest approval date. `npm run modules:generate` derives the frontend catalog. `npm run modules:check -- --base origin/main` rejects any module-folder update without a greater version. PR CI validates against the exact base commit without executing native manifests.

Create a development skeleton with `npm run module:new -- my-filter --kind dsp --author your-github-login`, or `--kind coldfire`. A scaffold is untested and does not enter the configurator automatically. Read [CONTRIBUTING.md](../CONTRIBUTING.md) before implementation.

Saved configurations, duplicates and imported JSON backups automatically select the current catalog versions. Legacy saves also use current versions; supplied version metadata is still validated before replacing it. Exported JSON records the active versions, but importing an older backup updates its selection to the current catalog. Availability, compatibility and build-verification gates still apply, and every build validates the current selection. Firmware never enters an export. Configurations save on the device. Export moves a private backup to another device; the forum can publish an explicitly selected snapshot of module choices and versions. There is no automatic cloud synchronization.

## Community forum and accounts

Public discussions are readable without an account. Registration and verified email are required to open threads, reply, comment, rate, like or submit issues. Better Auth supplies password and session handling through a small server-side facade. Resend sends verification and recovery emails; the frontend never receives mail credentials. See [forum setup, local sample data, security controls and operational limits](FORUM.md).

The forum supports general discussion, module help, public bug-report follow-up and fixed configuration snapshots, plus search, bookmarks, a notification bell with activity email digests and protected moderation. Config snapshots contain only module metadata. Report status changes reach the reporter in the bell and unread activity emails. Module pages let members follow new releases, and report forms offer this follow too. They also show how many public shared configurations include the module (`sharedConfigurations` in `GET /api/modules/<id>`, counted from the snapshot's module IDs on its machine; `GET /api/forum/threads?category=configs&module=<id>` lists them) and a Share control that uses the device share sheet or copies the module's public address. The build emits `module-releases.json`; the hourly Worker polls the deployed inventory at `APP_URL` rather than its independently deployed catalog. After the initial inventory baseline, each newly added module automatically creates one public announcement shown in a dismissible floating card; version updates retain the existing follower bell notifications. Release announcements are never emailed. After a firmware download, both build panels show “Open module guide”: the download automatically follows future module releases while preserving explicit opt-outs. The overview keeps thumbnails, version-matched screenshots, usage steps and flashing instructions on the current page. Each module offers “Works for me”, which immediately saves a working confirmation with the downloaded build context without creating a forum post, or “Report an issue”, which opens its issue form in a dialog with the downloaded module versions and OS prefilled. Reports retain the machine, OS and exact downloaded module versions. Every download schedules the shared overview after two seconds, including a repeat of a previously downloaded build. Existing working confirmations and later-reminder choices are preserved. It waits while the tab is hidden, another dialog is open or the member is editing. A persisted claim and browser lock keep it quiet on another tab or reload. Legacy downloads retain their existing inline reminders. Returning members see pending choices directly in a dismissible reminder; “Not yet” snoozes it for a day. Save confirmations are dismissible, disappear after six seconds and clear on navigation. Migration 0034 adds subscriptions and release notifications while preserving existing push deliveries. Activity email is on by default as a batched digest with one-click unsubscribe; see [FORUM.md](FORUM.md#notifications-and-activity-email).

Historical guest identities retain access to their private reports on the original device until their session expires or is replaced on sign-in. Names never transfer ownership to an account. New guest participation is closed. Administration continues to use its separate server-side key and tab session.

Existing generated “Works” forum reports render as a compact summary of machine, OS, tested module/version and companion modules, with the member’s comment below. Their Markdown, quoting and editing remain intact. Migration 0060 backfills these reports into `module_working_reports`; bounded reads normalize their metadata from the saved text. Source edits invalidate and regenerate that metadata, deleted sources remove it, and hidden sources do not count. Manual “Works on my…” replies still contribute. Counts show distinct active, verified members per tested module across versions; repeated reports, quotes and companion modules do not add extra members. Community reports remain separate from hardware qualification.

`POST /api/working-reports` accepts explicit `testedModuleIds` and optional downloaded `build` context (instrument, OS and all bundled module IDs/versions). A build is required for several tested modules, and every selected module must belong to it and the same instrument. The server resolves catalog names, preserves supplied historical versions, saves each selected module atomically, and deduplicates repeated confirmations from the same member/build. Context is retained for compatibility investigations; only aggregate counts are public. Records appear in account exports and are removed on account deletion. The endpoint creates no forum posts, follows or reply notifications.

Catalog pages show the count beside “Works for me”. One press saves only that module, including a saved download when available. Without one, installed version and OS stay unknown. Visitors get the existing sign-in prompt and unverified members go to their account. Success refreshes the count and marks the button “Reported working”; errors allow a retry. “After you flash” and returning-member reminders retain individual one-click Works buttons and add unselected module checkboxes, “Select all — I tested every module shown” and “Report selected working”. Selection is explicit; merely being bundled does not confirm a module. Bulk success completes only the selected pending reminders. Successful issue submissions from download follow-ups, return reminders and the check-in also complete that module’s pending feedback without marking it working. The issue dialog keeps its success links visible until closed. In the check-in, Done for now, Close and Escape dismiss this build’s reminders; Not yet snoozes the inline reminder for 24 hours. The full downloaded build context remains attached even when only pending modules are displayed.

Desktop groups the preview and three resource gauges beside the module details. Mobile keeps the preview first and all three gauges visible above the tabs. Update follows, issue reports and creator support retain their existing flows.

### Discord invitation

Send the prepared Discord announcement as **Public — everyone** to activate this invitation for both audiences. The former member/visitor popup is retired. The public card offers **Join Discord** to members, plus **Create account** to signed-out visitors; its message contains no signup request. A once-only claim is recorded when the card appears, even if no action is chosen. Existing invitation markers survive this presentation change.

On their next site visit, existing signed-in verified members receive one public-card invitation to the Modwerk development Discord. `POST /api/auth/discord-invite` atomically claims it in `member_discord_invites`, so another tab, device or later visit cannot show it again. The same private marker records that new members receive the invitation inline with signup instead; it is not an impression counter. Migration 0054 adds the marker, includes it in account exports and removes it with the account.

Signed-out visitors get no popup. They are invited by a public announcement linking to the development Discord (see [public announcements](COMMUNITY_OPERATIONS.md#public-and-signed-in-announcements)); its card shows Join Discord and, for signed-out visitors, Create account. `modwerk.discord-invite.visitor` records that this browser has handled a Discord invitation: the former visitor popup, a click or dismissal on a Discord card, or a completed member claim. Browsers with the marker skip Discord cards, and signing in carries it into the member marker via `alreadyShown`, so nobody is invited twice on a later visit or device. Unavailable storage limits the marker to the current visit. Account and developer sign-in pages are left uninterrupted. The member dialog waits until the page is visible and any other dialog has closed, and closes after choosing an action or pressing Escape.

New accounts never receive another member card. Email verification and completed social onboarding request a dismissible inline signup welcome on the original destination page, with the official Discord button and an optional Ko-fi link. The welcome is consumed once in the current tab and disappears when dismissed or navigating away; ordinary sign-ins do not request it. Completed registrations that began before this change are also excluded from the member card.

In local development, `?preview=discord-member` and `?preview=welcome` show the real UI without consuming invitations or recording invitation/link preview statistics. Invitation impressions and Join Discord, Create account and dismiss actions use existing site statistics with separate member and visitor totals; the visitor totals now come from Discord cards shown to signed-out visitors. Welcome Discord clicks have their own total; Ko-fi clicks use the existing support-link total.

### Issue reports

New module bugs use the module page’s amber “Report an issue” action. Module discussions warn before posting and offer to copy the written draft into that form; the forum composer cannot create bug reports.

Reports are structured, so authors can reproduce a problem across this many modules and configurations. Each report carries:

- a title and what happened, and optionally steps to reproduce and the expected result;
- the Octatrack model and what it is running (an Octamod build, not flashed yet, or back on stock);
- the configuration: its module ids and versions, the FX2 chooser setting and the base OS, plus the image's SHA-256 when it was built in this browser session (never the image itself);
- optionally, `OCTAMOD.LOG` from the card root, written by the on-device logger ([core logger](../sdk/runtime/logging/README.md)).

The configuration always comes from one of two places ([decision](DECISIONS.md#7-october-2026--the-configuration-comes-from-the-log-or-the-reporter-names-it)). An attached log records the modules, base OS and FX2 setting the device actually ran, so the Worker takes them from the validated log and ignores what the browser sent for those fields; the form shows the log's configuration instead of asking. Without a log the reporter names one in the form: a configuration saved in this browser, the active one preselected, or, when none fits or none with modules is saved, the modules picked one by one (chips plus a search box, so the form stays small as the catalog grows) at current catalog versions, with the reported module already listed. The Worker rejects a report that has neither a log nor at least one module; Digitakt and Digitone have no log, so they always name one.

The form asks only for a title, what happened, the device and the configuration. Steps to reproduce, the expected result and the device log sit in collapsed optional sections. The log section explains stopping playback, waiting for the checkpoint interval and saving, then USB DISK MODE or a card reader, and choosing OCTAMOD.LOG and OCTAMOD1.LOG from the top folder of the card. Files are checked locally; the complete one with the newest file date is selected, named and previewed before submission. After a crash, copy existing card logs; a power cycle does not guarantee recovery. Since 6 October 2026 the log is optional ([decision](DECISIONS.md#6-october-2026--short-issue-reports)). The Worker still validates a missing-log reason from older clients and rejects “before flashing” when the reporter says the unit runs an Octamod build. Logging is mandatory core infrastructure, never a selectable catalog module.

The browser and the Worker validate the log with the same strict parser (`src/community/ot-log.ts`, format in [FORMAT.md](../sdk/runtime/logging/FORMAT.md)). It accepts only printable ASCII in the OCTAMOD.LOG v1/v2 grammar (v2 also requires a completion CRC32), at most 64 KiB, so firmware, samples and project files are refused. Shared rules live in `src/community/issue-context.ts`.

### Reports about a whole configuration

When the problem is in the combination, or no single module is known to be at fault, **Report a problem** beside New in the configuration page’s header (Octatrack, Digitakt and Digitone) reports the saved configuration shown there ([decision](DECISIONS.md#10-october-2026--reports-about-a-whole-configuration)). It reaches the authors and maintainers of every catalog module in it, once each. A problem with one module still belongs on that module's own page.

- `POST /api/configuration-reports` takes the module report's fields except a module: title, what happened, optional steps and expected result, `context`, optional `log` (Octatrack only), `visibility`, `maintainerSharing` and `notifyUpdates`. The context is validated like a module report's, so an attached log decides the modules and Digitakt/Digitone name theirs. It needs at least one module the catalog still lists; the rest are kept in the private context but have no author to notify. The same per-IP, per-member and site limits apply, and the module report and configuration report share them.
- The report is one `issues` row with `scope = 'configuration'` and one `issue_modules` row per catalog module (community ID and the version the reporter ran, in configuration order; migration `0067`). `issues.module_id` holds the first of them, so existing joins keep a valid module, but nothing should read it as the module at fault.
- Every module's page lists it in **Issues**, flagged *Whole configuration* with the module list, and `GET /api/modules/<id>/issues` and `…/replies` accept any of its modules. A module's own Issues tab lists and counts them, but the per-module statistics behind the stability grade and the admin per-module table leave them out, because they cannot be attributed to one module; the admin totals still count them.
- A public report becomes one GitHub issue titled `[configuration] …`, labelled `issue-report`, `configuration` and `module:<id>` for each module, mentioning every distinct author and declared maintainer (at most 25 handles, in configuration order). It publishes the same description as a module report plus the module list with versions; the build fingerprint, the FX2 setting and any log stay private. The form says so before posting. Without `GITHUB_TOKEN` the report goes to the Bug Reports forum on the first module, and each current maintainer of any listed module gets one notification.
- Maintainers of any listed module can open the private report, its log and replies, and close or reopen it, as on a module report. The signed webhook accepts `/modwerk close` and `/modwerk reopen` from a registered maintainer of any listed module. `resolve` names the module, `/modwerk resolve <module-id> <version> verified-download`, because the fix ships in one module. That maintainer must still maintain it (revocation is per module), and the usual live-release gate applies; the release closes the whole report. `POST /api/developer/modules/<id>/releases/complete` accepts configuration report IDs the same way.
- The reporter follows releases of each listed module unless they opted out of it, and their bell and email say *configuration report*.
- Account export includes the report's `scope` and its `issue_modules`; account deletion removes them with the report.

GitHub is the one bug tracker ([decision](DECISIONS.md#5-october-2026--github-is-the-one-bug-tracker)). With `GITHUB_TOKEN` configured, a report the reporter submits publicly becomes a GitHub issue straight away, without a forum thread. The issue carries only the public snapshot in `issues.public_json` (title, device and base OS, module version, steps, expected and actual result, reporter username) and mentions the module author and maintainers. Configuration context and logs stay private to the reporter, the administrator and verified maintainers; the issue links maintainers to them. Private reports are never published, and the admin retry rejects them. Without the token, public reports go to the Bug Reports forum instead. Reports are capped at 60 per hour across the site, 10 per IP and 10 per member. Report copies are listed in Your account; there is no separate activity page.

Closing or reopening the GitHub issue updates the report's status through a signed `issues` webhook at `/api/github/webhook`, verified with `GITHUB_WEBHOOK_SECRET` and the configured repository. Status changes and new comments (`issue_comment`, bots excepted) notify the reporter in the bell and activity email; the `X-GitHub-Delivery` ID keeps a redelivered event from notifying twice. `GET /api/modules/<id>/issues` lists a module's open mirrored issues so the form can show them before a duplicate is filed. Resolving a report in the admin inbox also closes or reopens the GitHub issue. The admin inbox shows the context, a log summary, a log download and any existing GitHub link. Reports, contexts and logs are also kept in D1.

Module issue cards offer **GitHub replies**, and the private report opens that conversation automatically. `GET /api/modules/<module-id>/issues/<report-id>/replies?page=0` reads 20 current public GitHub comments per page, including earlier replies, edits and deletions on refresh. The report must belong to that module and have an explicitly published description and mapped GitHub issue; private/forum-only reports cannot use this endpoint. No configuration, logs, private replies, provider credentials or GitHub user email are returned. Replies use safe Markdown without remote images or HTML. Verified Modwerk members can post public replies through the same module-scoped endpoint with POST `{ body, requestId }`. The service attributes the Modwerk username/profile, quotes the supplied text, neutralizes mentions and uses a durable content-bound receipt plus GitHub comment marker for safe retries. It returns success only after GitHub confirms the comment. Public writes are capped at 20/member, 30/IP and 300/site per hour. Matching relay webhooks do not duplicate reporter notifications; users do not receive notifications for their own replies. Upstream failures show a retry and GitHub fallback, never an empty conversation. Reads are capped at 60 per IP and 1,500 across the site per hour to protect the shared GitHub API budget. Existing webhook notifications and release-completion checks remain independent of this read.

Claimed maintainers can use `PATCH /api/issues/<report-id>` with `status: "closed"`, `closureReason` (`configuration`, `duplicate`, `not_reproducible` or `withdrawn`) and a required public `note` to close a mirrored report without a new release. The existing reporter/administrator/current-maintainer access check still applies. The Worker posts the explanation with a retry marker before closing GitHub as `not_planned`, then updates local status and queues an `issue_closed` notification. GitHub failure leaves the local status unchanged; retries reuse the comment. Reopening uses `status: "open"`. This route claims no firmware fix and sends no module-release fanout; released fixes retain the scoped author completion and download-verification flow.

## PR approval and administration

Modules, code updates, documentation and media are submitted through GitHub PRs only. **The owner approves first releases; registered authors can request automatic merge and publication of their own later updates** under [the scoped policy](MODULE_AUTHOR_UPDATES.md). There is no second website approval step. Require reviewer verification and successful checks on the latest revision, protect main and never reuse a released version for changed contents. Pending PRs and failed release builds retain the previous publication.

Module manifests import plain-text descriptions, controls, evidence and rights metadata from source folders. `.github/workflows/pages.yml` compiles each authorized main commit in a container without network, credentials or stock firmware, mounting only the tracked tree of that one commit. The publisher independently confirms either an owner merge through the GitHub API (configured numeric `MODULE_APPROVER_GITHUB_ID`) or the bot merge, original author authority, exact change scope and successful base/head checks, current versions, the complete source inventory, the compiler and all nine artifact hashes. It publishes only if the build reproduces the committed packages, which were checked locally for native parity. Metadata generation alone cannot install arbitrary modules. See `docs/VERIFICATION.md` for what has and has not run.

The **Start developing** route provides one configurable coding-agent prompt, a compact task-specific visual flow and ecosystem context. Detailed requirements, author-release checkboxes and issue commands stay in the complete prompt, with its preview collapsed by default. Instruments come from the full generated registry; machines without SDKs get integration guidance rather than another machine's module commands. Shared context is in [Developer workflow](DEVELOPER_WORKFLOW.md), `src/community/developer-guidance.ts` and `starter-prompts.ts`. Repository links use `VITE_REPOSITORY_URL` or the Modwerk repository fallback. The former submission, repository-import and website-review API routes return 410. Existing database publication/history records and media reads remain for migration; no new version can bypass PR approval.

The private administrator workspace provides GitHub contribution entry points, published-record withdrawal, comment moderation, the issue inbox (with private logs and existing GitHub status) and history. Administration is separate from member participation: the backend owner configures `ADMIN_KEY_SHA256` (the SHA-256 of a random key from `npm run admin:key`), and the administrator exchanges that key for an eight-hour session kept only in the current tab. Every `/api/admin/` route checks it on the server; without a configured key the workspace stays closed. Rotating the key revokes all administrator sessions. A provider-specific gate such as Cloudflare Access can replace this during backend setup. Reviewer checks must cover behavior, evidence, resources, authorship, licences and original/media rights; review is not automatic legal clearance.

## GitHub Pages and community API setup

`.github/workflows/pages.yml` runs for every push to main, on manual dispatch and once a day, so new forum threads get their prerendered pages (see [FORUM.md](FORUM.md#thread-pages-feed-and-sitemap)). It verifies the owner or scoped author approval of the head commit. When module source, the compiler, the release scripts or the committed packages changed since the last successful release, it compiles modules in isolation and requires them to reproduce the committed packages. Frontend-only releases skip that compile; they confirm that the committed packages still match the module source fingerprint and compiler they were verified with. Every release then checks the app with Node 24, builds static files and publishes `dist/` to GitHub Pages. Once publication succeeds, the same job authenticates to the community API with GitHub OIDC and queues the existing module-follower notifications after the live inventory matches the build's hash. This uses no shared deployment secret and sends no email directly; the existing email preferences and digest schedule remain in force. The Worker configuration pins `RELEASE_REPOSITORY_ID` and `RELEASE_REPOSITORY_OWNER_ID` to this repository's immutable GitHub identities (read with `gh api repos/<owner>/<repo> --jq '{id,owner_id:.owner.id}'`); update both and `GITHUB_REPOSITORY` when hosting another repository. The hourly sync remains a retry fallback. Direct pushes without an authorized PR merge fail before anything is built. Actions, the runner image and the toolchain base image are pinned to exact versions; the container builds GNU binutils 2.47 for `m68k-elf` from the checksum-pinned official release, the same toolchain that produced the committed packages. Relative asset paths and hash navigation support repository URLs such as `https://<owner>.github.io/<repo>/` and root/custom-domain URLs. The site is published at https://modwerk.app; octamod.app redirects to it ([DOMAIN_AND_MAIL.md](DOMAIN_AND_MAIL.md)). The SDK belongs in this same repository; see [accepted decisions](DECISIONS.md).

The community runs separately through `worker.ts` and `wrangler.worker.jsonc`, initially using Cloudflare Worker and D1 free allowances. The account addition requires checking scrypt CPU/memory against the chosen plan before launch. The production API is `https://octamod-community.octamod.workers.dev/api`. Module screenshots and audio arrive through PRs and are served by the site, so no R2 bucket is bound; the read-only legacy media route stays inert without one. Better Auth is open source; Resend has a free sending tier. Hosting and sending limits still apply; free production capacity has not been established for the new account workload. The frontend uses the public `VITE_COMMUNITY_API_URL` ending in `/api`; leave it blank for the local Vite proxy. Only JSON, original/licensed preview media and community session data reach the API. No firmware endpoint exists.

Production setup (completed 1 October 2026; repeat these steps for another environment):

1. Enable GitHub Pages with GitHub Actions as its publishing source and protect `main` (required PR and checks; see [author-update setup](MODULE_AUTHOR_UPDATES.md#repository-setup) before requiring an owner review on every PR or changing rulesets; no merge queue, which would change the merging account). Set the repository variables `MODULE_APPROVER_GITHUB_ID` to the owner's numeric GitHub user ID (`gh api users/<login> --jq .id`) and `COMMUNITY_API_URL` to the deployed backend URL ending in `/api`. For a custom domain, verify it for Pages and set it in the Pages settings; with Actions publishing no `CNAME` file is needed.
2. Create a D1 database with `npx wrangler d1 create octamod-community`, put its ID in `wrangler.worker.jsonc` and apply all current migrations with `npx wrangler d1 migrations apply octamod-community --config wrangler.worker.jsonc --remote`.
3. Set `APP_URL` in `wrangler.worker.jsonc` to the full frontend URL with its trailing slash (`https://modwerk.app/`; include the repository path for a `github.io` project URL). Keep `SESSION_TRANSPORT=bearer` for separate domains.
4. Run `npm run admin:key` locally. Keep the printed key in a password manager and store only its digest as the Worker secret `ADMIN_KEY_SHA256`; never as a frontend `VITE_` value.
5. To track public bug reports on GitHub, enable Issues on the repository and create a fine-grained personal access token limited to that repository with **Issues: read and write**. Store it as the Worker secret `GITHUB_TOKEN` (`npx wrangler secret put GITHUB_TOKEN --config wrangler.worker.jsonc`); set `GITHUB_REPOSITORY` only if it differs from `repeat98/octamod`. Then add a repository webhook: payload URL `<community API>/github/webhook`, content type `application/json`, a random secret stored as the Worker secret `GITHUB_WEBHOOK_SECRET`, and the **Issues** and **Issue comments** events. Without the token, public reports go to the Bug Reports forum instead.
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

Successful reports offer the Modwerk report as the primary conversation link, with GitHub available as an optional secondary link. Existing-report checks link to the module’s frontend Issues tab. The server mentions the catalog author. If GitHub forwarding fails, the saved-report confirmation asks users not to submit duplicates.


## Documentation validation and deployment scope

Run `npm run check -- --base origin/main` before committing. The shared `scripts/change-scope.mjs` compares actual changes, including manifest prose and generated catalogues. Documentation-only edits validate licences, catalogue freshness, module contracts, tutorials and capture provenance without the application suite, lint, typecheck, bundle or native compilation. Unknown paths and source/behaviour changes retain the full app checks.

PR and Pages firmware builds follow firmware source and build identities rather than broad SDK directory changes. Digi documentation/version labels do not rebuild Octatrack packages. Source pins, build recipes, toolchains, code, linking metadata and package changes retain their native gates. Pages still bundles the site to publish updated documentation. Generated catalogue edits only redeploy the Worker when its consumed module fields change; a manual Worker dispatch still deploys.

### Scoped author release completion

`POST /api/developer/modules/<id>/releases/complete` requires the authenticated developer's current, unrevoked claimed module access. It accepts the exact catalog version, up to 25 privately shared report IDs from that module, and `verifiedDownload: true` after actual local verification. It re-fetches the live `module-releases.json` and rejects a missing/stale release before resolving reports. Mirrored GitHub issues receive only the public version/module link, then close as completed through the Worker's existing GitHub credential; the Modwerk report and reporter notification use the same transactional status helper as signed webhooks. Failed GitHub closure leaves local status open, and retries reuse the release comment and per-version notification keys. One module's completion cannot initialize the full-library release baseline.

Completion calls the existing preference-aware module-update fanout. Request dispatch starts eligible push delivery; activity mail follows its existing digest delay and quota. Counts returned to the author describe stored queued notifications, not provider acceptance or receipt. Do not give module authors administrator access or add a second broadcast/scheduler. GitHub comments now offer `/modwerk resolve <version> verified-download` after the author confirms the published fix on their unit. The signed command handler checks registered numeric identity, current module ownership, suspension, revoked claims and sharing consent, then uses the same live release gate and notification fanout. Website claims are not required for these registered-author public commands. The existing authenticated endpoint remains available for compatible clients; agents follow [the author-update guide](MODULE_AUTHOR_UPDATES.md).

## GitHub developer home

Developer public work stays in GitHub. The former workspace is **Creator settings**, retaining module claims, per-module Ko-fi links and direct consent-controlled private report links. It no longer fetches or shows a duplicate public report/activity inbox. Private replies/logs remain private. Report bell/email links open the user's report on Modwerk; frontend public replies go to the same GitHub conversation.

New GitHub issue descriptions explain registered-author commands: `/modwerk close configuration|duplicate|not_reproducible|withdrawn <explanation>`, `/modwerk reopen <explanation>` and version-bound `/modwerk resolve <version> verified-download`. Signed newly created comments only, no PRs, exact numeric identity and current reviewed module ownership. Commands do not grant general repository access or weaken release/hardware gates. Migration **0063_github_actions.sql** adds content-bound receipts and write leases; the existing Worker deployment applies it before code deployment. It stores hashes and identities, never private report text or credentials.
