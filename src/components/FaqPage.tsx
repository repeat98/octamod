import { INDEPENDENCE_NOTICE, FLASHING_RISKS } from '../firmware-notices'
import { isValidElement, useState } from 'react'
import type { ReactNode } from 'react'
import { BASE_FIRMWARE } from '../engine/base'
import { DOWNLOADS_ENABLED, DSP_LOADER } from '../engine/protocol'
import { Icon } from './Icon'

const OFFICIAL_OS = 'https://www.elektron.se/wp-content/uploads/2025/03/OCTATRACK_OS1.40C_dist.zip'
const RELEASE_NOTES = 'https://www.elektron.se/wp-content/uploads/2025/03/OCTATRACK_OS1.40C_readme.pdf'
const MKII_MANUAL = 'https://www.elektron.se/wp-content/uploads/2024/09/Octatrack-MKII-User-Manual_ENG_OS1.40A_210414.pdf'
const MKI_MANUAL = 'https://www.elektron.se/wp-content/uploads/2024/09/Octatrack-User-Manual_ENG-OS1.40A_220204.pdf'

function OfficialLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children} <span aria-hidden="true">↗</span></a>
}

function ManualLinks({ recovery = false }: { recovery?: boolean }) {
  return <p className="faq-source">Elektron manuals, §{recovery ? '18.3' : '8.5.2'}: <OfficialLink href={MKII_MANUAL + '#page=' + (recovery ? '112' : '33')}>MKII</OfficialLink> · <OfficialLink href={MKI_MANUAL + '#page=' + (recovery ? '113' : '33')}>MKI</OfficialLink></p>
}

type Question = { id: string; title: string; keywords: string; answer: ReactNode }
type FaqSection = { title: string; questions: Question[] }

const SECTIONS: FaqSection[] = [
  {
    title: 'Getting started',
    questions: [
      {
        id: 'base-firmware',
        title: 'Where do I get the original .bin firmware?',
        keywords: 'download base original stock official elektron os 1.40c zip extract file',
        answer: <>
          <p>Download <OfficialLink href={OFFICIAL_OS}>the original OS {BASE_FIRMWARE.version} archive from Elektron</OfficialLink>. Unzip it on your computer and choose <code>{BASE_FIRMWARE.filename}</code> in Octamod’s <a href="#configuration">Configuration</a> page.</p>
          <p>Choose the extracted .bin, not the ZIP archive or the .syx file. Octamod requires this exact, unmodified OS version, even if Elektron releases a newer one. You can also find firmware and manuals on <OfficialLink href="https://www.elektron.se/support-downloads/octatrack-mkii#resources">Elektron’s Octatrack download page</OfficialLink>.</p>
          <p>The original file is the starting point for your build. It does not contain the modules you select in Octamod.</p>
        </>,
      },
      {
        id: 'what-is-octamod',
        title: 'What is Octamod? Is it official Elektron firmware?',
        keywords: 'octabam custom experimental configurator endorsed supported warranty',
        answer: <>
          <p>Octamod lets you choose octabam modules and prepare a custom Octatrack firmware configuration in your browser. Each module page explains its controls, author and available test evidence.</p>
          <p>{INDEPENDENCE_NOTICE} {FLASHING_RISKS} Local build checks cannot guarantee hardware safety.</p>
        </>,
      },
      {
        id: 'mods-stability',
        title: 'Are the mods stable?',
        keywords: 'stable stability reliable reliability testing stress project cycles memory modulation hardware emulator performance live configuration',
        answer: <>
          <p>Test records describe what was checked on a particular version and setup. They do not guarantee that your combination of modules, Octatrack model and workload will behave reliably.</p>
          <p>New modules and updates must provide the following evidence for owner review:</p>
          <ol>
            <li>Worst-case cycle counts under parameter extremes, simultaneous modulation, mode changes and maximum supported load, within the available processing budget.</li>
            <li>Exact memory accounting for code, state, tables, buffers, stack/heap and shared allocations, including totals at the maximum instance count.</li>
            <li>Module-specific emulator/native checks and owner-reviewed real-hardware test evidence. Record the tester, date, tested source and build, observed behavior, workload and limitations. Reported functional operation must remain labelled as reported; a one-hour, eight-track stress run is no longer mandatory.</li>
            <li>Complete module documentation, a short practical tutorial and real screenshots matching the online modules’ black-and-white style. The owner reviews the documentation and test evidence before release.</li>
          </ol>
          <p>Emulator results cannot replace hardware testing. Existing modules retain their recorded evidence; read each module’s test conditions and limitations rather than assuming every configuration has been tested.</p>
          <p><strong>Always test your own configuration before relying on it.</strong> Start with a fresh Octatrack project after installing a new build, then rehearse your actual track count, module combinations, modulation, recording, streaming and transitions for a sustained run. Repeat after changing modules or versions, and keep a tested fallback for performances or important recordings.</p>
          {!DOWNLOADS_ENABLED && <p>Firmware downloads remain paused. Wait for the updated build to complete verification before installing a custom build from Octamod.</p>}
        </>,
      },
      {
        id: 'models',
        title: 'Does it work with the Octatrack MKI and MKII?',
        keywords: 'compatibility supported model hardware device 1.40c',
        answer: <>
          <p>Both models use the official OS {BASE_FIRMWARE.version} base file. That does not establish that every custom module or configuration works on both models. Review each module’s test records for evidence on your model.</p>
          <p>{DOWNLOADS_ENABLED ? 'A successful build checks that the configuration fits and the file is intact; it does not qualify your configuration on hardware.' : 'Octamod firmware downloads are paused while the built-in logger completes verification on both models.'}</p>
        </>,
      },
      {
        id: 'build-firmware',
        title: 'How do I build my own firmware?',
        keywords: 'select add modules configuration choose file build download json',
        answer: <>
          <ol>
            <li>Browse the <a href="#library">module library</a>, read the module pages and add the modules you want.</li>
            <li>Open <a href="#configuration">Configuration</a> and choose your original <code>{BASE_FIRMWARE.filename}</code>.</li>
            <li>Review compatibility messages and use the suggested fixes to resolve any errors before building.</li>
            <li>Read the flashing risks, tick the acknowledgement and choose <strong>Build firmware</strong>. Keep the tab open until it finishes.</li>
            <li>{DOWNLOADS_ENABLED ? <>Choose <strong>Download .bin</strong> when the finished file is ready.</> : 'Downloads are paused. You can check that a supported configuration builds, but Octamod will not offer a firmware file until verification is complete.'}</li>
          </ol>
          <p><strong>Export configuration</strong> saves a JSON backup of your choices. It is not a firmware file and cannot be flashed.</p>
        </>,
      },
    ],
  },
  {
    title: 'Flashing & recovery',
    questions: [
      {
        id: 'before-flashing',
        title: 'What should I do before flashing?',
        keywords: 'backup projects banks samples card sync restore safety risk memory',
        answer: <>
          <p>In the PROJECT menu’s PROJECT section, save your project and choose <strong>SYNC TO CARD</strong>. Then copy the entire CompactFlash card to your computer, including projects, banks and samples. Keep both the official .bin and .syx files available, and read the recovery procedure before installing custom firmware.</p>
          <p>After installing a new firmware build, create and open a fresh project on your Octatrack. Older projects that use stock effects replaced by your modules are not compatible with the modified firmware. Removing stock FX2 effects can also make existing projects incompatible. Keep your original project backups.</p>
          <p>Use a stable power supply and allow the update and startup to finish completely. Review module limitations and test your fresh project before using custom firmware in a live set. Some module configurations reserve about 10 MB of sample memory. The finished build explains whether your selection uses this reservation.</p>
          <p className="faq-source"><OfficialLink href={RELEASE_NOTES}>Elektron OS 1.40C update and backup instructions</OfficialLink></p>
        </>,
      },
      {
        id: 'flash-card',
        title: 'How do I flash a .bin from the CompactFlash card?',
        keywords: 'install update upgrade usb disk mode cf root eject system yes',
        answer: <>
          {!DOWNLOADS_ENABLED && <p><strong>Octamod downloads are paused.</strong> These steps also apply to installing the official Elektron .bin. Wait for Octamod downloads to resume before installing a custom build from this site.</p>}
          <ol>
            <li>Connect the Octatrack to your computer by USB. Open <strong>PROJECT → SYSTEM → USB DISK MODE</strong> and press <strong>YES</strong> (ENTER/YES on MKI).</li>
            <li>Copy the firmware .bin to the card’s root: the top level, outside every folder.</li>
            <li>Safely eject the Octatrack drive on your computer, then leave USB DISK MODE.</li>
            <li>Open <strong>PROJECT → SYSTEM → OS UPGRADE</strong>, press <strong>YES</strong> and confirm the update.</li>
            <li>Wait until updating and startup have fully finished, or the device asks you to restart. Never disconnect power during the update.</li>
          </ol>
          <p>After completion, confirm the OS version in the system status screen. Once startup has fully finished, power-cycle before testing a custom build with a copy of a project.</p>
          <ManualLinks />
        </>,
      },
      {
        id: 'bin-or-syx',
        title: 'What is the difference between .bin and .syx? Can I flash over USB?',
        keywords: 'midi din interface cable sysex transfer format rename',
        answer: <>
          <p>A .bin is for an update from the CompactFlash card. USB DISK MODE lets you copy that file to the card. A .syx is for sending an update through a MIDI interface into the Octatrack’s 5-pin DIN MIDI IN.</p>
          <p>The Octatrack’s USB port cannot receive a MIDI OS upgrade. Octamod’s firmware download format is .bin; for MIDI recovery, use the original .syx from Elektron’s archive. Renaming a .bin to .syx does not convert it.</p>
          <ManualLinks recovery />
        </>,
      },
      {
        id: 'recover',
        title: 'How do I recover an Octatrack that will not boot?',
        keywords: 'restore stock original stuck frozen failed boot startup func function trig 3 midi upgrade sysex',
        answer: <>
          <p>If an update is still running, keep power connected. If it has finished and the unit will not boot, try the MIDI update procedure in the startup menu:</p>
          <ol>
            <li>Connect your computer’s MIDI interface OUT to the Octatrack’s DIN MIDI IN.</li>
            <li>With the Octatrack off, hold <strong>FUNC</strong> (FUNCTION on MKI) while powering it on.</li>
            <li>Press <strong>TRIG 3</strong> for <strong>MIDI UPGRADE</strong> and wait for the receive prompt.</li>
            <li>Send Elektron’s original <code>OCTATRACK_OS1.40C.syx</code> with a SysEx application, such as Elektron Transfer, using the connected MIDI output.</li>
            <li>Wait for the transfer, flash update and startup to finish. Follow any restart prompt.</li>
          </ol>
          <p>Recovery is not guaranteed. If the startup menu is unavailable or the official update fails, contact <OfficialLink href="https://www.elektron.se/support">Elektron support</OfficialLink>. EMPTY RESET clears settings and is not a firmware reinstall.</p>
          <ManualLinks recovery />
        </>,
      },
      {
        id: 'return-to-stock',
        title: 'Can I go back to the original Elektron OS?',
        keywords: 'revert uninstall downgrade restore stock backup project',
        answer: <>
          <p>If the Octatrack boots, install the original <code>{BASE_FIRMWARE.filename}</code> from Elektron using the CompactFlash procedure above. If it does not boot, try the official .syx through the startup menu’s MIDI UPGRADE.</p>
          <p>Keep your backups: projects saved with custom modules may not behave correctly under the original OS. Elektron does not support OS downgrades and warns that user content may be lost.</p>
          <p className="faq-source"><OfficialLink href={RELEASE_NOTES}>Elektron’s update and downgrade guidance</OfficialLink></p>
        </>,
      },
    ],
  },
  {
    title: 'Troubleshooting',
    questions: [
      {
        id: 'download-status',
        title: 'Why is there no firmware download button?',
        keywords: 'paused disabled missing ready built hardware audio effects load failed',
        answer: <>
          <p>{DOWNLOADS_ENABLED ? 'The download button appears only after a successful build. Choose the original base firmware, add supported modules, resolve configuration errors and acknowledge the flashing risks first.' : 'Firmware downloads are paused. The built-in logger is undergoing verification. Downloads will resume after the updated builds have passed review.'}</p>
          <p>A build that fits and passes local file checks is not proof that it will work on hardware. You can still export your configuration as JSON.</p>
        </>,
      },
      {
        id: 'rejected-file',
        title: 'Why does Octamod reject my firmware file?',
        keywords: 'invalid size fingerprint verification checksum wrong version modified syx zip https',
        answer: <>
          <p>Octamod accepts only the original <code>{BASE_FIRMWARE.filename}</code>. Extract it from Elektron’s archive again and select the .bin. Other OS versions, .syx files, ZIP archives and already modified firmware cannot be used as the base. Renaming a file will not make it valid.</p>
          <p>If the message mentions HTTPS, open Octamod at its secure HTTPS address. A local preview works on localhost; an unsecured preview over Wi-Fi cannot verify firmware.</p>
        </>,
      },
      {
        id: 'configuration-errors',
        title: 'What if my modules do not fit or a module is unavailable?',
        keywords: 'compatibility placement memory capacity stock fx2 versions pending verification paused crackling',
        answer: <>
          <p>Follow the message in Configuration and use the suggested compatible choices. For a capacity error, remove a module and check the revised configuration again. {DSP_LOADER ? <>You can also turn off <strong>Keep stock FX2 effects</strong> for a shorter FX2 menu.</> : <>Custom effects take the space of the original FX2 reverbs they need (Spring, Plate or Dark), and only those are left out of the FX2 menu. The build summary names them. If the module menus need more room, the FX2 menu lists only your modules.</>} All original FX1 effects remain available.</p>
          <p>Saved configurations and imported backups automatically use the current module versions. Review the module pages for changes; each build checks the current selection again. Modules marked <strong>Build verification pending</strong> cannot be included in a build yet. A temporarily withdrawn module must be removed from an older saved configuration before building.</p>
        </>,
      },
      {
        id: 'card-file',
        title: 'Why can’t the Octatrack find the update on my card?',
        keywords: 'bin cf compactflash root folder zip json extension eject copy missing upgrade',
        answer: <>
          <p>Check that the extracted .bin is at the top level of the CompactFlash card, outside all folders. A ZIP archive, .syx or configuration JSON is not a card update. Confirm the copy completed and safely eject the drive before choosing OS UPGRADE.</p>
          <p>Follow the instructions for your model if the unit reports an error. Do not interrupt an update already in progress.</p>
          <ManualLinks />
        </>,
      },
    ],
  },
  {
    title: 'Privacy & sharing',
    questions: [
      {
        id: 'local-firmware',
        title: 'Is my firmware uploaded? How do I remove it?',
        keywords: 'privacy device browser saved storage indexeddb cache clear forget offline sync',
        answer: <>
          <p>Your firmware stays in this browser on your device. Octamod saves the verified original file locally and verifies it again when you return. It is never uploaded, synced, logged or included in configuration exports.</p>
          <p>Open <a href="#configuration">Configuration</a> and choose <strong>Remove from device</strong> below Base firmware to delete the saved copy from Octamod. This does not delete your original download or uninstall firmware from the Octatrack. Clearing browser site data also removes local configurations and the saved file.</p>
        </>,
      },
      {
        id: 'share-configuration',
        title: 'Can I share my configuration or a finished firmware file?',
        keywords: 'export import json backup send copyright redistribute bin syx modules',
        answer: <>
          <p>Share the JSON file from <strong>Export configuration</strong>. Another person can use <strong>Import JSON</strong> in Configuration and supply their own original OS {BASE_FIRMWARE.version} file. Your browser’s saved configurations do not sync between devices automatically.</p>
          <p>Do not redistribute original or built firmware .bin or .syx files: they contain Elektron’s copyrighted OS. Share your module choices instead.</p>
        </>,
      },
      {
        id: 'community',
        title: 'Do I need an account? How do I report a module issue?',
        keywords: 'guest comments ratings likes email sign in bug author community github contribution',
        answer: <>
          <p>Browsing and the configurator work without an account. To post in the forum, comment, rate, like or use <strong>Report an issue</strong>, register and verify your email. Your email address stays private. Follow your reports in <a href="#account">Your account</a>.</p>
          <p>Describe the module, your Octatrack model, the displayed OS version and how to reproduce the problem. Never attach firmware. Module contributions and updates go through GitHub pull requests and owner review; see <a href="#submit">Submit a module</a>.</p>
        </>,
      },
    ],
  },
]

function answerText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(answerText).join(' ')
  if (isValidElement<{ children?: ReactNode }>(node)) return answerText(node.props.children)
  return ''
}

const SEARCH_TEXT = new Map(SECTIONS.flatMap(section => section.questions.map(question => [
  question.id,
  (section.title + ' ' + question.title + ' ' + question.keywords + ' ' + answerText(question.answer)).toLowerCase(),
])))

export function FaqPage() {
  const [query, setQuery] = useState('')
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const searching = terms.length > 0
  const sections = SECTIONS.map(section => ({
    ...section,
    questions: section.questions.filter(question => terms.every(term =>
      SEARCH_TEXT.get(question.id)!.includes(term),
    )),
  })).filter(section => section.questions.length > 0)
  const count = sections.reduce((total, section) => total + section.questions.length, 0)

  return <div className="faq-page">
    <div className="page-heading"><div><p className="page-kicker">OCTAMOD / HELP</p><h1>Frequently asked questions</h1><p>From your first firmware file to flashing, recovery and sharing.</p></div></div>
    {!DOWNLOADS_ENABLED && <aside className="risk-note" role="note"><strong>Octamod firmware downloads are paused</strong><p>The built-in logger is undergoing verification. You can explore modules and check supported configurations while the updated builds await review. The official Elektron OS remains available from Elektron.</p></aside>}
    <div className="faq-tools">
      <label className="faq-search"><Icon name="search" size={17} /><input type="search" aria-label="Search FAQ" placeholder="Search firmware, flashing, recovery…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <a className="button button-quiet" href="#configuration">Open configuration <Icon name="arrow" size={15} /></a>
    </div>
    {searching && <p className="faq-results" role="status">{count} {count === 1 ? 'answer' : 'answers'} found</p>}
    {sections.map(section => <section className="faq-section" key={section.title} aria-label={section.title}>
      <h2>{section.title}</h2>
      <div className="faq-questions">{section.questions.map(question => <details className="faq-question" key={question.id + (searching ? '-search' : '')} open={searching || question.id === 'base-firmware'}>
        <summary>{question.title}<Icon name="plus" size={17} /></summary>
        <div className="faq-answer">{question.answer}</div>
      </details>)}</div>
    </section>)}
    {!count && <div className="no-results"><Icon name="search" size={28} /><h2>No answers found</h2><p>Try “.bin”, “MIDI” or “backup”.</p><button className="button button-quiet" onClick={() => setQuery('')}>Clear search</button></div>}
    <p className="faq-footer">For the full update procedure, read the <OfficialLink href={RELEASE_NOTES}>official OS 1.40C instructions</OfficialLink> and the manual for your model.</p>
  </div>
}
