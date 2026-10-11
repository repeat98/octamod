import { useState, type ReactNode } from 'react'
import { changeCount, inventoryChanges, type Inventory, type InventoryTarget } from '../config/inventory'
import type { OctatrackLink } from '../engine/elekloader/octatrack-link'
import { useInventory, useOctatrackLink } from '../hooks/useOctatrackLink'
import { ChangeSummary } from './InventoryChanges'
import { Icon } from './Icon'
import './octatrack-link.css'

/** The builder: the target set as what the base loads. */
export type PrepareUpdate = (target: InventoryTarget) => Promise<{ name: string; data: Uint8Array }>
/** The base: what is on the unit. */
export type ReadInventory = () => Promise<Inventory>
export type StressTest = () => Promise<string | null>
const STEPS = ['Load', 'Stress test', 'Keep']

/**
 * The checkout card's flow once an Octatrack with the Modwerk base is connected: update it over USB
 * (stop playback, load, stress test, keep or undo) instead of building a .bin for the card, which stays
 * one click away. Without such a unit, `children` (the .bin flow) shows with a hint about USB.
 * `prepareUpdate` (the builder) and `stressTest` (the test runner) are absent until they exist.
 */
export function OctatrackUpdate({ link, set, prepareUpdate, readInventory, stressTest, onInstall, children }: {
  link: OctatrackLink
  /** The module set on this page; loading makes the unit match it. */
  set: InventoryTarget
  readInventory?: ReadInventory
  prepareUpdate?: PrepareUpdate
  stressTest?: StressTest
  onInstall: () => void
  children: ReactNode
}) {
  const state = useOctatrackLink(link), inventory = useInventory(link, readInventory)
  const moduleCount = set.moduleIds.length, changes = inventory && inventoryChanges(inventory, set)
  const [download, setDownload] = useState(false)
  const [preparing, setPreparing] = useState<'idle' | 'busy' | 'failed'>('idle')
  const { status, identity, active, module, progress = 0, tested, notice } = state
  const base = !!identity?.canSubmit && ['ready', 'sending', 'testing', 'trial', 'finishing'].includes(status)

  if (!base || download) return <>
    {children}
    {status === 'idle' && <p className="usb-hint">Got the Modwerk base? Plug in your Octatrack to update it over USB. <button className="text-button" onClick={() => void link.connect()}>Connect</button></p>}
    {(status === 'stock' || status === 'ready' && !identity?.canSubmit) && <p className="usb-hint">Your Octatrack is connected. Install the Modwerk base once to update it over USB. <button className="text-button" onClick={onInstall}>Install the base</button></p>}
    {status === 'busy' && <p className="usb-hint">Another tab or app is using your Octatrack. <button className="text-button" onClick={() => void link.retry()}>Try again</button></p>}
    {base && <p className="usb-hint"><button className="text-button" onClick={() => setDownload(false)}>Update over USB instead</button></p>}
  </>

  async function update() {
    setPreparing('busy')
    try { const prepared = await prepareUpdate!(set); setPreparing('idle'); await link.update(prepared.name, prepared.data, stressTest) }
    catch (error) { console.error(error); setPreparing('failed') }
  }
  const step = status === 'sending' ? 0 : status === 'testing' ? 1 : 2
  const busy = status !== 'ready'
  const text = status === 'sending' ? (progress < 1 ? `Loading… ${Math.round(progress * 100)}%` : 'Starting…')
    : status === 'testing' ? 'Stress-testing on your Octatrack…'
    : status === 'trial' || status === 'finishing' ? `${tested ? 'Passed. ' : ''}${module} is running. Try it, then keep it or undo.`
    : preparing === 'busy' ? 'Preparing your modules…'
    : changes && !changeCount(changes) ? 'Your Octatrack already matches this module set.'
    : 'Your Octatrack will match this module set. Playback stops, the stress tests run, then you keep it or undo.'
  return <section className="build-section usb-update" aria-labelledby="usb-update-title" aria-busy={status === 'sending' || status === 'testing' || status === 'finishing'}>
    <div>
      <h2 id="usb-update-title">Load onto your Octatrack</h2>
      <p className="usb-identity"><span className="status-dot verified" />{identity!.model} · base {identity!.base.slice(0, 8)}{inventory ? ` · ${inventory.moduleIds.length} ${inventory.moduleIds.length === 1 ? 'module' : 'modules'} installed` : active && (active === identity!.base ? ' · no modules' : ' · last module ' + active.slice(0, 8))}</p>
      <p role="status">{text}</p>
      {busy && <div className="build-progress" role="progressbar" aria-label="Update progress" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={step}>
        <ol className="build-progress-steps" aria-hidden="true">{STEPS.map((label, i) => <li key={label} className={i < step ? 'is-complete' : i === step ? 'is-active' : undefined}>
          <span className="build-progress-track" /><span className="build-progress-label"><span className="build-progress-marker">{i < step ? <Icon name="check" size={14} /> : i + 1}</span><span>{label}</span></span>
        </li>)}</ol>
      </div>}
      {status === 'ready' && changes && changeCount(changes) > 0 && <ChangeSummary changes={changes} />}
      {status === 'trial' && <p className="subtle">Unplugging or closing the site also undoes it.</p>}
      {preparing === 'failed' && <p className="file-error" role="alert">This module set could not be prepared for USB.</p>}
      {notice && <p className={notice.tone === 'success' ? 'success-note' : 'file-error'} role={notice.tone === 'success' ? 'status' : 'alert'}>{notice.text}</p>}
    </div>
    <div className="build-actions">
      {status === 'ready' && <button className="button button-primary" disabled={!prepareUpdate || (!moduleCount && !inventory?.moduleIds.length) || (!!changes && !changeCount(changes)) || preparing === 'busy'} onClick={() => void update()}><Icon name="download" size={16} />Load onto Octatrack</button>}
      {status === 'ready' && (!moduleCount && !inventory?.moduleIds.length ? <p className="export-note">Add at least one module from the library.</p> : !prepareUpdate && <p className="export-note">The browser can’t build updates yet.</p>)}
      {status === 'sending' && progress < 1 && <button className="button button-quiet" onClick={() => link.cancel()}>Cancel</button>}
      {(status === 'trial' || status === 'finishing') && <><button className="button button-primary" disabled={status === 'finishing'} onClick={() => void link.keep()}><Icon name="check" size={16} />Keep</button><button className="button button-quiet" disabled={status === 'finishing'} onClick={() => void link.undo()}>Undo</button></>}
      {status === 'ready' && <button className="text-button" onClick={() => setDownload(true)}>Download .bin instead</button>}
    </div>
  </section>
}
