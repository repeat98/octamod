import { useState } from 'react'
import { MODULES } from '../catalog/modules'
import { changeCount, inventoryChanges, type Inventory, type InventoryTarget } from '../config/inventory'
import type { Configuration } from '../config/workspace'
import type { OctatrackLink } from '../engine/elekloader/octatrack-link'
import { useInventory, useOctatrackLink } from '../hooks/useOctatrackLink'
import { Icon } from './Icon'
import { ChangeSummary } from './InventoryChanges'
import { ModulePreview } from './ModulePreview'
import type { PrepareUpdate, ReadInventory, StressTest } from './OctatrackUpdate'
import { StockEffects } from './StockEffects'
import './octatrack-link.css'

/**
 * What is on the Octatrack now, and changing it: remove modules, switch stock effects off, load a module
 * set (the unit then matches it) or save what is there as one. Every change is a load like any other:
 * playback stops, the stress tests run, then Keep or Undo (the activity pill follows it).
 */
export function YourOctatrack({ link, sets, prepareUpdate, readInventory, stressTest, onInstall, onSaveSet }: {
  link?: OctatrackLink
  sets: Configuration[]
  prepareUpdate?: PrepareUpdate
  readInventory?: ReadInventory
  stressTest?: StressTest
  onInstall: () => void
  onSaveSet: (target: InventoryTarget) => void
}) {
  if (!link) return <div className="your-octatrack"><header className="page-heading"><div><h1>Your Octatrack</h1><p>Managing your Octatrack over USB needs Chrome or Edge on a computer.</p></div></header></div>
  return <Connected link={link} sets={sets} prepareUpdate={prepareUpdate} readInventory={readInventory} stressTest={stressTest} onInstall={onInstall} onSaveSet={onSaveSet} />
}

function Connected({ link, sets, prepareUpdate, readInventory, stressTest, onInstall, onSaveSet }: Parameters<typeof YourOctatrack>[0] & { link: OctatrackLink }) {
  const state = useOctatrackLink(link), inventory = useInventory(link, readInventory)
  const [draft, setDraft] = useState<Inventory>()
  const [setId, setSetId] = useState('')
  const [preparing, setPreparing] = useState<'idle' | 'busy' | 'failed'>('idle')
  const { status, identity, active } = state, base = !!identity?.canSubmit
  const busy = preparing === 'busy' || ['sending', 'testing', 'trial', 'finishing'].includes(status)
  const current = draft ?? inventory, chosen = sets.find(item => item.id === setId) ?? sets[0]
  const edits = inventory && draft ? inventoryChanges(inventory, { name: 'Your Octatrack', ...draft }) : undefined
  const setChanges = inventory && chosen ? inventoryChanges(inventory, chosen) : undefined, editing = !!edits && changeCount(edits) > 0

  async function load(target: InventoryTarget) {
    setPreparing('busy')
    try { const prepared = await prepareUpdate!(target); setPreparing('idle'); setDraft(undefined); await link.update(prepared.name, prepared.data, stressTest) }
    catch (error) { console.error(error); setPreparing('failed') }
  }
  const heading = <header className="page-heading"><div><h1>Your Octatrack</h1><p>{base ? `${identity!.model} · Modwerk base ${identity!.base.slice(0, 8)}` : 'What is on your Octatrack, and what you change on it.'}</p></div>{base && <span className="pill your-octatrack-state"><span className={'status-dot ' + (busy ? 'is-live' : 'verified')} />{busy ? 'Loading' : 'Connected'}</span>}</header>
  if (!base) return <div className="your-octatrack">{heading}<section className="configuration-section your-octatrack-empty">
    {status === 'unsupported' ? <p>Managing your Octatrack over USB needs Chrome or Edge on a computer.</p>
      : status === 'stock' || status === 'ready' ? <><p>Your Octatrack is connected, but it runs {status === 'stock' ? 'the original OS' : 'a Modwerk base this site can’t talk to'}. Install the Modwerk base once from the card.</p><button className="button button-primary" onClick={onInstall}>Install the base</button></>
      : status === 'busy' ? <><p>Another tab or app is using your Octatrack.</p><button className="button button-primary" onClick={() => void link.retry()}>Try again</button></>
      : status === 'connecting' ? <p>Looking for your Octatrack…</p>
      : <><p>Plug in your Octatrack with a USB cable and switch it on.</p><button className="button button-primary" onClick={() => void link.connect()}><Icon name="arrow" size={16} />Connect</button><button className="text-button" onClick={onInstall}>First time? Install the Modwerk base</button></>}
  </section></div>

  return <div className="your-octatrack">
    {heading}
    <section className="configuration-section" aria-labelledby="installed-title">
      <div className="section-title"><h2 id="installed-title">Installed modules {current && <span className="subtle">{current.moduleIds.length}</span>}</h2>{inventory && <button className="text-button" onClick={() => onSaveSet({ name: 'From my Octatrack', ...inventory })}>Save as module set <Icon name="plus" size={14} /></button>}</div>
      {!readInventory ? <p className="service-note">This Modwerk base can’t list its modules yet.{active && active !== identity!.base && ` The last module it took is ${active.slice(0, 8)}.`}</p>
        : !current ? <p className="service-note">Reading what’s on your Octatrack…</p>
        : current.moduleIds.length ? <ul className="selected-list">{current.moduleIds.map(id => { const module = MODULES.find(item => item.id === id)
          return <li key={id}><span className="selected-module-link"><ModulePreview id={id} compact /><span><strong>{module?.name ?? id}</strong><small>{module ? module.detail + ' · ' + module.authorName : 'Not in the library'}</small></span></span>
            <button className="icon-button" aria-label={'Remove ' + (module?.name ?? id)} disabled={busy} onClick={() => setDraft({ ...current, moduleIds: current.moduleIds.filter(item => item !== id) })}><Icon name="close" size={17} /></button></li> })}</ul>
        : <p className="service-note">Nothing installed yet. Load a module set below.</p>}
    </section>
    {current && <StockEffects removed={current.removedStockFx} disabled={busy} onChange={removedStockFx => setDraft({ ...current, removedStockFx })} />}
    <section className="configuration-section" aria-labelledby="load-set-title">
      <div className="section-title"><h2 id="load-set-title">Load a module set</h2><a className="text-button" href="#module-sets">All module sets <Icon name="arrow" size={14} /></a></div>
      {sets.length ? <>
        <label className="your-octatrack-set"><span className="sr-only">Module set</span><select value={chosen?.id} onChange={event => setSetId(event.target.value)}>{sets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.moduleIds.length} {item.moduleIds.length === 1 ? 'module' : 'modules'}</option>)}</select></label>
        {setChanges && (changeCount(setChanges) ? <ChangeSummary changes={setChanges} /> : <p className="service-note">Your Octatrack already matches this set.</p>)}
        <div className="build-actions"><button className="button button-primary" disabled={!prepareUpdate || busy || editing || (!!setChanges && !changeCount(setChanges))} onClick={() => void load(chosen!)}><Icon name="download" size={16} />Load onto Octatrack</button></div>
      </> : <p className="service-note">You have no Octatrack module sets yet. <a className="text-button" href="#library">Browse modules</a></p>}
      {!prepareUpdate && <p className="subtle">The browser can’t build updates yet.</p>}
      {preparing === 'failed' && <p className="file-error" role="alert">These modules could not be prepared for USB.</p>}
    </section>
    {editing && <aside className="your-octatrack-edits" aria-label="Your changes">
      <div><strong>{changeCount(edits!)} {changeCount(edits!) === 1 ? 'change' : 'changes'}</strong><ChangeSummary changes={edits!} /></div>
      <button className="button button-quiet" onClick={() => setDraft(undefined)}>Discard</button>
      <button className="button button-primary" disabled={!prepareUpdate || busy} onClick={() => void load({ name: 'Your Octatrack', ...draft! })}>Apply to Octatrack</button>
    </aside>}
  </div>
}
