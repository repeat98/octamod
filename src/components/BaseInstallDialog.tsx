import { useEffect, useRef, useState } from 'react'
import { saveFirmware } from '../config/firmware-filename'
import type { OctatrackLink } from '../engine/elekloader/octatrack-link'
import { useOctatrackLink } from '../hooks/useOctatrackLink'
import { RiskAcceptance } from './ConfigurationLayout'
import { Icon, type IconName } from './Icon'
import './octatrack-link.css'

export interface BaseImage { buffer: ArrayBuffer; sha256: string }
/** The release prompt holds this long before it can be put off. */
const LAUNCH_HOLD_SECONDS = 10
// What the release prompt promises. Every line must be true on release day: cross-compatibility, stock effects
// kept, the stress tests and the automatic reports are still to be built (docs/OCTATRACK_ELEKLOADER_MIGRATION.md).
const ALSO_NEW: [IconName, string, string][] = [
  ['grid', 'As many modules as fit', ', all selectable from the Octatrack’s menus'],
  ['check', 'All modules are cross-compatible', ', no more conflicts between them'],
  ['sliders', 'Stock effects stay', ', none of them get replaced'],
  ['wave', 'Effects load on demand', ', straight onto the DSP chip when you pick them'],
  ['shield', 'Automatic stress tests', ' for every module and module set before it lands'],
  ['message', 'Automatic bug reports', ' when something fails, straight to the module’s author'],
]
const SCREEN = ['LOADING', 'TRYING', 'KEPT']

// The Octatrack MKII front panel, traced from a photo (panel 1238 x 640 px, top-left at 22, 322) and scaled into the hero.
const OT = { x: 316, y: 40, scale: 306 / 1238 }
const at = (x: number, y: number) => [OT.x + (x - 22) * OT.scale, OT.y + (y - 322) * OT.scale]
function Key({ x, y, w = 38, h = 38, className = 'signal-ghost', delay }: { x: number; y: number; w?: number; h?: number; className?: string; delay?: number }) {
  const [cx, cy] = at(x, y)
  return <rect className={className} style={delay === undefined ? undefined : { animationDelay: delay + 's' }} x={cx - w * OT.scale / 2} y={cy - h * OT.scale / 2} width={w * OT.scale} height={h * OT.scale} rx="2" />
}
function Knob({ x, y, r = 25 }: { x: number; y: number; r?: number }) {
  const [cx, cy] = at(x, y)
  return <g className="signal-secondary"><circle cx={cx} cy={cy} r={r * OT.scale} /><path d={`M${cx} ${cy - r * OT.scale}v${r * OT.scale * .55}`} /></g>
}
const KEYS: [number, number, number?, number?][] = [
  [77, 519], [193, 497], [251, 497], [309, 497], [75, 592], [134, 592], [192, 592], [251, 592], [309, 592], [193, 687, 60], [88, 775, 60], [193, 775, 60],
  [285, 716], [285, 775], [401, 716], [343, 775], [401, 775], [459, 775], ...[439, 497, 556, 614].flatMap(y => [[423, y], [792, y]] as [number, number][]),
  ...[491, 549, 607, 666, 724].map(x => [x, 670, 40] as [number, number, number]), [909, 576, 40], [1197, 870, 60, 40],
]
/** A sine squiggle like the module cards' art, `w` wide around (x, y). */
const squiggle = (x: number, y: number, w: number, a: number) => Array.from({ length: 13 }, (_, i) => (i ? 'L' : 'M') + (x + i * w / 12).toFixed(1) + ' ' + (y + Math.sin(i / 12 * Math.PI * 3) * a).toFixed(1)).join(' ')

/** This page (the module library, one card on its way) and an Octatrack MKII on a USB cable, drawn like the module previews. */
function LinkHero() {
  const [sx, sy] = at(473, 425), screenW = 269 * OT.scale, screenH = 205 * OT.scale, [fx, fy] = at(940, 745)
  return <div className="module-preview link-hero" aria-hidden="true">
    <div className="preview-label"><span>NEW</span><span className="preview-led" /></div>
    <svg viewBox="0 0 640 220" className="signal-art link-hero-art" fill="none">
      <g className="signal-grid">{[60, 110, 160].map(y => <path key={y} d={'M12 ' + y + 'H628'} />)}{[128, 256, 384, 512].map(x => <path key={x} d={'M' + x + ' 12V204'} />)}</g>
      {/* This page: sidebar, search, a grid of module cards; the highlighted one is being sent. */}
      <rect className="signal-secondary" x="24" y="44" width="200" height="128" rx="7" />
      <path className="signal-secondary" d="M12 180H236L224 190H24Z" />
      <rect className="signal-ghost" x="96" y="52" width="64" height="6" rx="3" />
      {[64, 72, 80, 88, 96].map((y, row) => <rect key={y} className={row ? 'signal-ghost' : 'signal-main'} x="34" y={y} width={row ? 22 : 26} height="3" rx="1.5" />)}
      {[0, 1].flatMap(row => [0, 1, 2].map(col => {
        const x = 74 + col * 48, y = 66 + row * 52, sent = row === 0 && col === 1
        return <g key={row + '-' + col}>
          <rect className={sent ? 'signal-main link-hero-pick' : 'signal-ghost'} x={x} y={y} width="44" height="46" rx="3" />
          <path className={sent ? 'signal-main' : 'signal-secondary'} d={squiggle(x + 7, y + 17, 30, 6)} />
          <rect className="signal-ghost" x={x + 7} y={y + 34} width="20" height="3" rx="1.5" />
        </g>
      }))}
      {/* The cable reaches the USB socket on the unit's top edge. */}
      <path className="signal-ghost" d="M236 182C292 182 282 18 384 18H500Q512 18 512 32V40" />
      <path className="signal-main link-hero-flow" d="M236 182C292 182 282 18 384 18H500Q512 18 512 32V40" />
      <rect className="signal-secondary" x={OT.x} y={OT.y} width={1238 * OT.scale} height={640 * OT.scale} rx="6" />
      <rect className="link-hero-screen" x={sx} y={sy} width={screenW} height={screenH} rx="2" />
      <text className="link-hero-name" x={sx + screenW / 2} y={sy + 14} textAnchor="middle">PREVIEW VOL</text>
      {SCREEN.map((word, i) => <text key={word} className={'link-hero-word' + (i ? '' : ' is-first')} style={{ animationDelay: -2 * ((3 - i) % 3) + 's' }} x={sx + screenW / 2} y={sy + screenH / 2 + 8} textAnchor="middle">{word}</text>)}
      <Knob x={102} y={437} r={22} />
      {[180, 209, 238, 267, 296, 325].map(x => { const [cx, cy] = at(x, 458); return <circle key={x} className="signal-secondary" cx={cx} cy={cy} r="1" /> })}
      {KEYS.map(([x, y, w, h], i) => <Key key={i} x={x} y={y} w={w} h={h} />)}
      <Key x={88} y={687} w={62} h={36} className="signal-secondary" />
      {[573, 642, 711].map(x => <Key key={x} x={x} y={775} w={60} className="signal-secondary" />)}
      {[[910, 477], [1007, 477], [1106, 477], [1205, 477], [1007, 576], [1106, 576], [1205, 576]].map(([x, y]) => <Knob key={x + '-' + y} x={x} y={y} />)}
      <path className="signal-secondary" d={`M${fx} ${fy}H${at(1120, 745)[0]}`} /><Key x={940} y={745} w={14} h={44} className="signal-secondary" />
      <Key x={846} y={746} w={60} h={60} /><Key x={1196} y={746} w={60} h={60} />
      {[1165, 1185, 1205, 1226].map(x => { const [cx, cy] = at(x, 828); return <circle key={x} className="signal-secondary" cx={cx} cy={cy} r="1.2" /> })}
      {Array.from({ length: 16 }, (_, i) => <Key key={'trig' + i} x={89 + i * 69.2} y={870} w={58} h={58} className="rhythm-off link-hero-trig" delay={i * 0.15} />)}
      <text x="124" y="208" textAnchor="middle">THIS PAGE</text><text x={OT.x + 153} y="212" textAnchor="middle">OCTATRACK MKII</text>
    </svg>
  </div>
}

/**
 * The one place to install the Modwerk base. The USB card opens it at any time; at
 * release it opens once per member (`launch`) and cannot be put off for the first
 * seconds. Step 4 completes by itself when the unit comes back with the base.
 * `buildBase` is the builder's seam, absent until the browser can build the base.
 */
export function BaseInstallDialog({ link, launch = false, firmwareReady, onChooseFirmware, buildBase, onClose }: {
  link: OctatrackLink
  launch?: boolean
  firmwareReady: boolean
  onChooseFirmware: (file: File) => void
  buildBase?: () => Promise<BaseImage>
  /** `done` is false when the browser closed it early (Escape before the page was clicked), which must not count as seen. */
  onClose: (done: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), fileRef = useRef<HTMLInputElement>(null), finished = useRef(false)
  const state = useOctatrackLink(link)
  const [hold, setHold] = useState(launch ? LAUNCH_HOLD_SECONDS : 0)
  const [accepted, setAccepted] = useState(false)
  const [download, setDownload] = useState<'idle' | 'building' | 'done' | 'failed'>('idle')
  const [view, setView] = useState<'intro' | 'steps'>(launch ? 'intro' : 'steps')
  const found = state.status === 'ready' && !!state.identity?.canSubmit
  const canClose = hold === 0 || found
  useEffect(() => {
    const element = dialog.current, previousFocus = document.activeElement
    element?.showModal(); element?.querySelector('h2')?.focus()
    return () => { element?.close(); if (previousFocus instanceof HTMLElement) previousFocus.focus() }
  }, [])
  useEffect(() => { dialog.current?.querySelector('h2')?.focus(); dialog.current?.scrollTo(0, 0) }, [view])
  useEffect(() => {
    if (!hold) return
    const timer = window.setTimeout(() => setHold(hold - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [hold])
  function finish() { finished.current = true; onClose(true) }
  async function downloadBase() {
    setDownload('building')
    try { const image = await buildBase!(); saveFirmware(image.buffer, 'base', image.sha256); setDownload('done') }
    catch (error) { console.error(error); setDownload('failed') }
  }
  const step = (done: boolean, number: number) => <span className="link-step-marker" aria-hidden="true">{done ? <Icon name="check" size={14} /> : number}</span>

  return <dialog ref={dialog} className="base-install-dialog" aria-labelledby="base-install-title" aria-describedby="base-install-intro" onCancel={event => { event.preventDefault(); if (canClose) finish() }} onClose={() => { if (!finished.current && !dialog.current?.open) onClose(false) }}>
    {canClose && <button type="button" className="icon-button base-install-close" aria-label="Close" onClick={finish}><Icon name="close" size={18} /></button>}
    {view === 'intro' ? <>
      <LinkHero />
      <h2 id="base-install-title" className="link-title" tabIndex={-1}>Load modules over USB</h2>
      <p id="base-install-intro" className="base-install-intro">Install the Modwerk base once from the card. After that, modules go straight from this page to your Octatrack, without the card and without a reboot.</p>
      <ul className="link-promises">{ALSO_NEW.map(([icon, lead, rest]) => <li key={lead}><span className="link-feature-icon" aria-hidden="true"><Icon name={icon} size={18} /></span><span><strong>{lead}</strong>{rest}</span></li>)}</ul>
      <p className={'link-needs' + (state.status === 'unsupported' ? ' is-missing' : '')}>You need an Octatrack MKII, your OS 1.40C file, a USB cable and Chrome or Edge on a computer.</p>
      {state.status === 'unsupported' && <p className="file-error" role="alert">This browser can’t talk to USB devices. Open this page in Chrome or Edge on a computer.</p>}
    </> : <>
    <header className="base-install-header"><h2 id="base-install-title" tabIndex={-1}>Install the Modwerk base</h2></header>
    <p id="base-install-intro" className="base-install-intro">Install it once from the card, like an OS update. {launch && <button type="button" className="text-button" onClick={() => setView('intro')}>What’s new?</button>}</p>
    <ol className="link-steps">
      <li className={download === 'done' ? 'is-complete' : undefined}>{step(download === 'done', 1)}<div className="link-step-body">
        <strong>Download the base</strong>
        <p>Built in your browser from your original OS 1.40C file. Nothing is uploaded.</p>
        {!firmwareReady && <><button type="button" className="button button-quiet" onClick={() => fileRef.current?.click()}><Icon name="file" size={16} />Choose your OS 1.40C file</button>
          <input ref={fileRef} type="file" accept=".bin" hidden aria-label="Choose your original OS 1.40C file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onChooseFirmware(file) }} />
          <a className="text-button" href="#faq" target="_blank" rel="noreferrer">Where do I get it? <Icon name="arrow" size={14} /></a></>}
        <RiskAcceptance checked={accepted} onChange={setAccepted} />
        <button type="button" className="button button-primary" disabled={!buildBase || !firmwareReady || !accepted || download === 'building'} onClick={() => void downloadBase()}><Icon name="download" size={16} />{download === 'building' ? 'Building the base…' : 'Download base .bin'}</button>
        {!buildBase && <p className="link-hint">The browser can’t build the base yet.</p>}
        {download === 'failed' && <p className="file-error" role="alert">The base could not be built. Check your OS file and try again.</p>}
        {download === 'done' && <p className="link-hint" role="status">Download requested. Check your browser’s downloads folder.</p>}
      </div></li>
      <li>{step(false, 2)}<div className="link-step-body">
        <strong>Copy it to the card</strong>
        <p>Connect USB, open <b>PROJECT → SYSTEM → USB DISK MODE</b> and press <b>YES</b>. Copy the .bin to the top level of the card. Eject the drive on your computer before you leave USB DISK MODE.</p>
      </div></li>
      <li>{step(false, 3)}<div className="link-step-body">
        <strong>Install it</strong>
        <p>Open <b>PROJECT → SYSTEM → OS UPGRADE</b>, press <b>YES</b> and confirm. Keep the power on until the Octatrack has restarted.</p>
      </div></li>
      <li className={found ? 'is-complete' : undefined}>{step(found, 4)}<div className="link-step-body">
        <strong>Check it</strong>
        {found ? <p role="status">Found the Modwerk base on your {state.identity!.model}. You can send modules now.</p>
          : state.status === 'unsupported' ? <p>Checking needs Chrome or Edge on a computer.</p>
          : <><p>Leave the USB cable in. This page finds the base by itself once the Octatrack has restarted.</p>{state.status === 'idle' && <button type="button" className="button button-quiet" onClick={() => void link.connect()}>Connect</button>}</>}
      </div></li>
    </ol>
    <p className="link-hint">The original OS goes back on the same way. If the Octatrack doesn’t start, follow <a className="text-button" href="#faq" target="_blank" rel="noreferrer">recovery in the FAQ</a>.</p>
    </>}
    <footer className="base-install-footer">
      <p className="link-hint">{found ? 'All set.' : 'It’s under Your Octatrack whenever you want it.'}</p>
      <div className="base-install-actions">
        <button type="button" className={'button ' + (found ? 'button-primary' : 'button-quiet')} disabled={!canClose} onClick={finish}>{found ? 'Done' : !launch ? 'Close' : hold ? `Later (${hold})` : 'Later'}</button>
        {view === 'intro' && !found && <button type="button" className="button button-primary" onClick={() => setView('steps')}>Show me how<Icon name="arrow" size={16} /></button>}
      </div>
    </footer>
  </dialog>
}
