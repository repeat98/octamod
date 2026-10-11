import { DigiModPreview } from './DigiModPreview'
export { DigiModPreview } from './DigiModPreview'
export { DigiModDetail } from './DigiModDetail'
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { downloadDigiSelection, parseDigiSelection } from '../config/digi-selection'
import { Icon } from '../components/Icon'
import { assetUrl } from '../hosting'
import { projectMachineForDevice } from '../projects/projects'
import { issueRepository } from '../community/report-context'
import type { Configuration } from '../config/workspace'
import { LIBRARY_CATEGORY_LABELS, STANDALONE_NOTE, type FirmwareModule, type ModuleCategory } from '../catalog/modules'
import { DETAILS } from '../catalog/details'
import type { CatalogBrowse } from '../catalog/catalog-browse'
import { AVAILABLE_MODULES } from '../catalog/availability'
import type { SelectionConflict } from '../catalog/selection-conflicts'
import type { AddBlock } from '../catalog/add-blocks'
import { moduleStability, STABILITY_NOTE } from '../catalog/module-stability'
import { AddButton, CardProof, CardStats, ModuleCard } from '../components/ModuleCard'
import { SelectionWarning } from '../components/SelectionWarning'
import { LibraryTools } from '../components/LibraryTools'
import { LibraryResultsBar } from '../components/LibraryResultsBar'
import { compareModules, downloadCoverage, type ModuleStatistics } from '../community/module-statistics'
import { RATING_RANKING_NOTE } from '../community/rating-ranking'
import { DeviceImage, PhotoCredit } from './DeviceImage'
import { ALL_MACHINES, DEVICES, DEVICES_BY_ID, DEVICE_STEPS, STATUS_LABELS, deviceHref, deviceTitle, stepsDone, type DeviceProfile } from './registry'
import { DIGI_CORES, DIGI_MODS, estimateCombination, type DigiMod } from './digi-mods'
import { MemberGate } from '../community/MemberGate'
import { useDigiFirmware } from '../hooks/useDigiFirmware'
import { DigiFirmwarePanel } from '../components/DigiFirmwarePanel'
import { DigiBuildPanel } from '../components/DigiBuildPanel'
import { ConfigurationHeader } from '../components/ConfigurationLayout'
import { ModuleAuthors } from '../components/ModuleAuthors'
import { contributorSearchText } from '../catalog/module-authors'

type DigiDevice = DeviceProfile & { id: DigiMod['device'] }
const STEP_LABELS = { done: 'Done', started: 'Started', open: 'Open' } as const

function kib(bytes: number) { return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KiB' }

function DigiModCard({ mod, selected, statistics, compared, canCompare, onToggle, onCompare, onBrowse }: { mod: DigiMod; selected: boolean; statistics?: ModuleStatistics; compared: boolean; canCompare: boolean; onToggle: () => void; onCompare: () => void; onBrowse?: () => void }) {
  const href = deviceHref(mod.device, 'module/' + mod.id)
  const stability = moduleStability(statistics, { hardware: mod.hardware ? 'Author-tested on hardware.' : 'Author release, not yet tested in Modwerk.' })
  return <article className={'module-card ' + (selected ? 'is-selected' : '')}>
    <a href={href} onClick={onBrowse} onAuxClick={onBrowse} className="module-cover" aria-label={'View ' + mod.title}><DigiModPreview mod={mod} /><div className="hover-info"><span>{mod.summary}</span><strong>Explore module <Icon name="arrow" size={15} /></strong></div></a>
    <div className="module-card-body">
      <div className="module-card-title">
        <div className="module-card-heading"><a href={href} onClick={onBrowse} onAuxClick={onBrowse}>{mod.title}</a><div className="card-release"><span className="card-version">v{mod.version}</span></div></div>
        <AddButton name={mod.title} selected={selected} onToggle={onToggle} />
      </div>
      <div className="card-credit"><ModuleAuthors name={mod.author} url={mod.repository} contributors={mod.contributors}/><span>{mod.license}</span></div>
      <p className="card-description">{mod.summary}</p>
      <div className="card-bottom"><span>{mod.category}</span><CardStats statistics={statistics}><span className="card-stat">{kib(mod.ramBytes)} memory</span></CardStats></div>
      <CardProof stability={stability} name={mod.title + ' for ' + DEVICES_BY_ID[mod.device].name} compared={compared} canCompare={canCompare} onCompare={onCompare} />
    </div>
  </article>
}

// All machines: every mod in one library, grouped by machine. Adding a mod puts it in that machine's configuration.
type AllMachinesLibraryProps = {
  query: string
  onBrowse?: (browse: CatalogBrowse) => void
  machinePicker?: ReactNode
  category?: ModuleCategory
  octatrackModules: readonly FirmwareModule[]
  octatrackSelected: string[]
  onToggleOctatrack: (id: string) => void
  digiSelected: Record<DigiMod['device'], string[]>
  onToggleDigi: (device: DigiMod['device'], id: string) => void
  family: string
  onFamilyChange: (value: string) => void
  sort: string
  onSortChange: (value: string) => void
  statistics: readonly ModuleStatistics[] | null
  octatrackConflicts: readonly SelectionConflict[]
  // What adding each Octatrack module would do to the current configuration, by module id.
  octatrackBlocks?: Record<string, AddBlock>
  onSwapOctatrack?: (id: string, removeIds: readonly string[]) => void
  comparison: readonly string[]
  onCompare: (id: string) => void
  onOpenComparison: () => void
  viewedModuleVersions: Record<string, string>
  moduleBaseline: readonly string[] | null
}

// One mounted library keeps its machine picker, heading and controls in place while the collection changes.
// On phones the machine picker sits in the category row and the results bar renders into resultsSlot, beneath it.
type MachineLibraryProps = AllMachinesLibraryProps & { device?: DeviceProfile; children?: ReactNode; onClearSearch?: () => void; phone?: boolean; resultsSlot?: HTMLElement | null }

export function MachineLibrary({ device, query, category, octatrackModules: octatrack, octatrackSelected, onToggleOctatrack, digiSelected, onToggleDigi, family, onFamilyChange, sort, onSortChange, statistics, octatrackConflicts, octatrackBlocks, onSwapOctatrack, comparison, onCompare, onOpenComparison, viewedModuleVersions, moduleBaseline, machinePicker, children, onClearSearch, onBrowse, phone = false, resultsSlot }: MachineLibraryProps) {
  const term = query.toLowerCase().trim()
  const hasMods = !device || device.status === 'available' || device.status === 'preview'
  const families = Array.from(new Set([
    ...(!device || device.id === 'octatrack' ? AVAILABLE_MODULES.map(module => DETAILS[module.id].family) : []),
    ...DIGI_MODS.filter(mod => !device || mod.device === device.id).map(mod => mod.category),
  ]))
  const libraryFamily = families.includes(family) ? family : 'all'
  // Each module in view before the type filter, by type: the phone type sheet counts what each choice would show.
  const scopeFamilies = [
    ...(!device || device.id === 'octatrack' ? AVAILABLE_MODULES.filter(module => (!category || module.category === category) && (module.name + ' ' + module.description + ' ' + module.authorName + ' ' + module.author + ' ' + contributorSearchText(module.contributors)).toLowerCase().includes(term)).map(module => DETAILS[module.id].family) : []),
    ...DIGI_MODS.filter(mod => (!device || mod.device === device.id) && (!category || mod.libraryCategory === category) && (mod.title + ' ' + mod.summary + ' ' + mod.author + ' ' + contributorSearchText(mod.contributors)).toLowerCase().includes(term)).map(mod => mod.category),
  ]
  const typeCounts = families.map(value => ({ value, count: scopeFamilies.filter(item => item === value).length })).filter(option => option.count || option.value === libraryFamily)
  const warnings = [
    ...((!device || device.id === 'octatrack') && octatrackConflicts.length ? [{device: DEVICES_BY_ID.octatrack, description: 'Some modules cannot run together. Choose a compatible set in your module set.'}] : []),
    ...(['digitakt', 'digitone'] as const).filter(id => !device || device.id === id).flatMap(id => {
      const estimate = estimateCombination(id, digiSelected[id])
      return !estimate.fits || estimate.clashes.length ? [{device: DEVICES_BY_ID[id], description: !estimate.fits ? 'The selected mods need more memory than this machine shares with mods.' : 'The selected mods cannot be used together.'}] : []
    }),
  ]
  const digiGroups = (['digitakt', 'digitone'] as const).filter(id => !device || device.id === id).map(id => ({
    id,
    mods: DIGI_MODS.filter(mod => mod.device === id && (!category || mod.libraryCategory === category) && (libraryFamily === 'all' || mod.category === libraryFamily) && (mod.title + ' ' + mod.summary + ' ' + mod.author + ' ' + contributorSearchText(mod.contributors)).toLowerCase().includes(term))
      .sort((a,b) => compareModules({id: id + '-' + a.id, name: a.title, authorName: a.author, updatedAt: a.updatedAt}, {id: id + '-' + b.id, name: b.title, authorName: b.author, updatedAt: b.updatedAt}, sort, statistics)),
  }))
  function browseResults() {
    onBrowse?.({
      route: !device ? 'all' + (category ? '/' + category : '') : deviceHref(device.id, category ?? '').slice(1),
      query, family: libraryFamily, sort,
      ids: [...(!device || device.id === 'octatrack' ? octatrack.map(module => module.id) : []), ...digiGroups.flatMap(group => group.mods.map(mod => group.id + '-' + mod.id))],
    })
  }
  const groups: { device: DeviceProfile; count: number; cards: ReactNode[] }[] = [
    ...(!device || device.id === 'octatrack' ? [{device: DEVICES_BY_ID.octatrack, count: octatrack.length, cards: octatrack.map(module => <ModuleCard key={module.id} module={module} selected={octatrackSelected.includes(module.id)} statistics={statistics?.find(item => item.module_id === module.id)} viewedVersion={viewedModuleVersions[module.id]} baseline={moduleBaseline} compared={comparison.includes(module.id)} canCompare={comparison.length < 3 || comparison.includes(module.id)} onToggle={() => onToggleOctatrack(module.id)} onCompare={() => onCompare(module.id)} onBrowse={browseResults} block={octatrackBlocks?.[module.id]} onSwap={removeIds => onSwapOctatrack?.(module.id, removeIds)} />)}] : []),
    ...digiGroups.map(({ id, mods }) => ({device: DEVICES_BY_ID[id], count: mods.length, cards: mods.map(mod => <DigiModCard key={mod.id} mod={mod} selected={digiSelected[id].includes(mod.id)} statistics={statistics?.find(item => item.module_id === id + '-' + mod.id)} onToggle={() => onToggleDigi(id, mod.id)} compared={comparison.includes(id + '-' + mod.id)} canCompare={comparison.length < 3 || comparison.includes(id + '-' + mod.id)} onCompare={() => onCompare(id + '-' + mod.id)} onBrowse={browseResults} />)})),
  ]
  const total = groups.reduce((sum, group) => sum + group.count, 0)
  const shownGroups = groups.filter(group => group.count)
  const onlyGroup = !device && shownGroups.length === 1 ? shownGroups[0].device : undefined
  const resultsSummary = !hasMods ? 'No modules yet · ' + device?.name : term ? total + ' ' + (total === 1 ? 'result' : 'results') + ' for “' + query.trim() + '”' : total + ' ' + (total === 1 ? 'module' : 'modules') + ' · ' + ((device ?? onlyGroup)?.name ?? 'All machines')
  return <div className="library-page">
    <div className="page-heading"><div><p className="page-kicker">MODWERK / {device?.name.toUpperCase() ?? 'ALL MACHINES'}</p><h1>{category ? LIBRARY_CATEGORY_LABELS[category] : device ? 'Module library' : 'All mods'}</h1><p>{category === 'standalone' ? STANDALONE_NOTE : 'Explore modules for your Elektron instruments.'}</p></div><span className="library-total">{total} modules</span></div>
    {device && projectMachineForDevice(device.id) && <p className="machine-external-projects"><a href={assetUrl('projects/') + '?machine=' + projectMachineForDevice(device.id)}>Other projects for {device.name} <Icon name="arrow" size={14} /></a></p>}
    {!!warnings.length && <SelectionWarning warnings={warnings.map(warning => ({id: warning.device.id, title: warning.device.name + ': your selection needs a change', description: warning.description, href: deviceHref(warning.device.id, 'configuration')}))} />}
    {phone ? resultsSlot && createPortal(<LibraryResultsBar summary={resultsSummary} sort={sort} onSortChange={onSortChange} family={libraryFamily} onFamilyChange={onFamilyChange} families={typeCounts} allCount={scopeFamilies.length} disabled={!hasMods} />, resultsSlot) : <LibraryTools family={libraryFamily} families={families} onFamilyChange={onFamilyChange} sort={sort} onSortChange={onSortChange} comparisonCount={comparison.length} onCompare={onOpenComparison} buildHref={hasMods ? deviceHref(device?.id ?? 'octatrack', 'configuration') : null} buildLabel={hasMods ? 'Build firmware for ' + (device?.name ?? 'Octatrack') : 'No modules to build yet'} machine={machinePicker} disabled={!hasMods} />}
    {device || !total ? <div className="library-subheading"><span>{term ? 'Results for “' + query.trim() + '”' : 'Explore the collection'}</span><span className="subtle">{device ? device.name + (device.firmware ? ' · OS ' + device.firmware.releases.join(' / ') : ' · no modules yet') : 'All machines'}</span></div> : null}
    {shownGroups.map(group => <section key={group.device.id} className={'machine-section' + (onlyGroup ? ' is-only-group' : '')} aria-labelledby={!device ? 'machine-' + group.device.id : undefined}>
      {!device && <div className="library-subheading"><span id={'machine-' + group.device.id}>{group.device.name} <span className="subtle">· {group.count} {group.count === 1 ? 'module' : 'modules'}{group.device.status === 'preview' ? ' · preview' : ''}</span></span><div className="machine-library-actions"><a className="text-button" href={deviceHref(group.device.id)}>Open {group.device.name} library <Icon name="arrow" size={13} /></a>{group.device.id !== 'octatrack' && <a className="button button-primary" href={deviceHref(group.device.id,'configuration')} aria-label={'Build firmware for ' + group.device.name}><Icon name="sliders" size={16}/>Build firmware</a>}</div></div>}
      <div className="module-grid">{group.cards}</div>
    </section>)}
    {hasMods ? <>
      <p className="popularity-note">{statistics ? downloadCoverage(statistics[0]?.downloadsStarted) : 'Popularity counts are currently unavailable.'}{sort === 'rated' && ' ' + RATING_RANKING_NOTE}{' ' + STABILITY_NOTE}{device && sort === 'recent' && device.id !== 'octatrack' && ' Addition dates are not available yet; this sort uses name order.'}</p>
      {!total && <div className="no-results"><Icon name={term || libraryFamily !== 'all' ? 'search' : category === 'standalone' ? 'lock' : 'grid'} size={30} /><h2>{term || libraryFamily !== 'all' ? 'No modules found' : 'No ' + (category ? LIBRARY_CATEGORY_LABELS[category].toLowerCase() : 'modules') + ' here yet'}</h2><p>{term || libraryFamily !== 'all' ? 'Try another name, type or author.' : 'Be the first to publish one: every machine follows the same SDK.'}</p>{onClearSearch && (term || libraryFamily !== 'all') ? <button className="button button-quiet" onClick={onClearSearch}>Clear search</button> : <a className="button button-quiet" href={term || libraryFamily !== 'all' ? deviceHref(device?.id ?? ALL_MACHINES) : issueRepository() + '/blob/main/docs/SDK.md'}>Browse modules</a>}</div>}
      {children}
      {device && <div className="library-note"><span className="status-dot" /><p>{device.id === 'octatrack' ? 'This catalog follows an experimental build. Review each module before preparing a module set.' : 'Built from each author’s pinned public release, with credit and licence.'}</p></div>}
      {!device && <section className="machine-section"><div className="library-subheading"><span>No mods yet</span><span className="subtle">Help open the next machine</span></div><div className="machine-chips">{DEVICES.filter(machine => machine.status === 'research' || machine.status === 'open').map(machine => <a key={machine.id} href={deviceHref(machine.id)} className={'machine-chip is-' + machine.status}>{machine.name}{machine.variants && <small> {machine.variants.join(' · ')}</small>}</a>)}</div></section>}
    </> : device && <EmptyMachine device={device} embedded />}
  </div>
}

export function DigiConfiguration({ device, configuration, configurations, onSelect, onDialog, onToggle, onImport, onReport }: { device: DigiDevice; onReport: () => void; configuration?: Configuration; configurations: Configuration[]; onSelect: (id: string) => void; onDialog: (mode: 'create' | 'rename' | 'duplicate' | 'delete') => void; onToggle: (id: string) => void; onImport: (configuration: ReturnType<typeof parseDigiSelection>) => void }) {
  const importRef = useRef<HTMLInputElement>(null), [buildResults, setBuildResults] = useState<HTMLDivElement | null>(null), [importError, setImportError] = useState(''), [importNotes, setImportNotes] = useState<string[]>([]), [exported, setExported] = useState('')
  const firmware = useDigiFirmware(device.id)
  const ids = configuration?.moduleIds ?? []
  const selection = DIGI_MODS.filter(mod => mod.device === device.id && ids.includes(mod.id))
  const estimate = estimateCombination(device.id, ids, firmware.firmware?.release)
  const percent = Math.min(100, estimate.usedBytes / estimate.areaBytes * 100)
  const exportKey = JSON.stringify(configuration)
  async function importBackup(file?: File) {
    if (!file) return
    setImportError(''); setImportNotes([])
    try { if (file.size > 32 * 1024) throw new Error('Module set backups must be smaller than 32 KB.'); const imported = parseDigiSelection(await file.text(), device.id); onImport(imported); setImportNotes(imported.notes) }
    catch(error) { setImportError(error instanceof Error ? error.message : 'Unable to import this module set.') }
  }
  return (
    <div className="configuration-page">
      <ConfigurationHeader kicker={'YOUR WORKSPACE · ' + device.name.toUpperCase()} meta={device.name + ' · OS ' + (device.firmware?.releases.join(' / ') ?? '') + ' · Changes save automatically on this device.'} emptyTitle={'No ' + device.name + ' module set yet'} configuration={configuration} configurations={configurations} onSelect={onSelect} onDialog={onDialog} onImport={() => importRef.current?.click()} shareHref={'#forum/new?category=configs&machine=' + device.id} canReport={!!ids.length} onReport={onReport}/>
      <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Import module set backup" onChange={event => { void importBackup(event.target.files?.[0]); event.target.value = '' }}/>
      {importError && <p className="file-error" role="alert">{importError}</p>}
      {importNotes.length > 0 && <div className="import-notes" role="status"><strong>Imported from an older catalog</strong>{importNotes.map(note => <p key={note}>{note}</p>)}</div>}
      <div className="configuration-layout">
        <div className="configuration-main">
          <section className="configuration-section" aria-labelledby="digi-selection-title"><div className="section-title"><h2 id="digi-selection-title">Selected modules <span className="subtle">{selection.length}</span></h2><a className="text-button" href={deviceHref(device.id)}>Browse modules <Icon name="plus" size={14} /></a></div>
            {selection.length ? <ul className="selected-list">{selection.map(mod => <li key={mod.id}><a className="selected-module-link" href={deviceHref(device.id, 'module/' + mod.id)}><DigiModPreview mod={mod} compact /><span><strong>{mod.title}</strong><small>{mod.category} · {mod.author} · {kib(mod.ramBytes)}</small></span></a><button className="icon-button" aria-label={'Remove ' + mod.title} onClick={() => onToggle(mod.id)}><Icon name="close" size={17} /></button></li>)}</ul>
              : <div className="selection-empty"><Icon name="grid" size={26} /><strong>No modules selected</strong><p>Find something in the library and add it to your module set.</p><a className="button button-quiet" href={deviceHref(device.id)}>Browse modules</a></div>}
          </section>
          <section className="configuration-section" aria-labelledby="digi-resources-title"><div className="section-title"><h2 id="digi-resources-title">Resources</h2><span className="subtle">core {DIGI_CORES[device.id].version} · {DIGI_CORES[device.id].slots}</span></div>
            <div className={'resource-meter' + (estimate.fits ? '' : ' is-over')} role="meter" aria-valuemin={0} aria-valuemax={estimate.areaBytes} aria-valuenow={estimate.usedBytes} aria-label="Shared mod memory">
              <div className="resource-meter-head"><strong>Shared mod memory</strong><span>{kib(estimate.usedBytes)} of {kib(estimate.areaBytes)}</span></div>
              <div className="resource-meter-track"><span style={{ width: percent + '%' }} /></div>
              <small>{estimate.fits ? 'Estimated from each mod’s code and data sizes; the build’s own check decides.' : 'Over the shared area: this set will not link. Remove a mod.'}</small>
            </div>
            {estimate.clashes.map((clash, index) => <p key={clash.claim + index} className="file-error" role="alert">{clash.mods.join(' and ')} cannot be used together: {clash.claim}.</p>)}
          </section>
          <section className="configuration-section" aria-labelledby="digi-firmware-title"><div className="section-title"><h2 id="digi-firmware-title">Base firmware</h2><span className="subtle">Read locally</span></div>
            <DigiFirmwarePanel name={device.name} releases={device.firmware?.releases ?? []} firmware={firmware} />
          </section>
          <div ref={setBuildResults} className="build-results" />
        </div>
        <div className="configuration-checkout">
          <section className={'compatibility-panel compatibility-' + (estimate.fits && !estimate.clashes.length ? 'clear' : 'conflict')} aria-live="polite" aria-labelledby="digi-compatibility-title"><div className="compatibility-heading"><span className="compatibility-icon"><Icon name={estimate.fits && !estimate.clashes.length ? 'shield' : 'sliders'} size={20}/></span><div><h2 id="digi-compatibility-title">{!estimate.fits || estimate.clashes.length ? 'Your selection needs a change' : selection.length ? 'No declared conflicts' : 'Choose your modules'}</h2><p>{!estimate.fits || estimate.clashes.length ? 'Review the resources below and choose a compatible set.' : selection.length ? 'Choose your base firmware for placement checks.' : 'Add a module from the library, or build the core alone. Compatibility updates as you make changes.'}</p></div></div></section>
          <div className="checkout-card"><MemberGate action="build firmware" next={device.id+'/configuration'}><DigiBuildPanel device={device} firmware={firmware} moduleIds={ids} onExport={() => { if (configuration) { downloadDigiSelection(configuration, device.id); setExported(exportKey) } }} exported={exported===exportKey} canExport={!!configuration} results={buildResults}/></MemberGate></div>
        </div>
      </div>
    </div>
  )
}

function Hero({ device, children, embedded = false }: { device: DeviceProfile; children?: ReactNode; embedded?: boolean }) {
  const Heading = embedded ? 'h2' : 'h1'
  return (
    <header className={'device-hero is-' + device.status}>
      <div className="device-hero-media"><div className="device-hero-art" role="img" aria-label={deviceTitle(device)}><DeviceImage device={device} /></div><PhotoCredit device={device} /></div>
      <div className="device-hero-copy">
        <p className="page-kicker">MODWERK / {device.name.toUpperCase()}</p>
        <Heading>{device.name}{device.variants && <span className="device-variants"> {device.variants.join(' · ')}</span>}</Heading>
        <p>{device.summary}</p>
        <div className="device-hero-meta"><span className={'device-status is-' + device.status}>{STATUS_LABELS[device.status]}</span></div>
        {children}
      </div>
    </header>
  )
}

// Machines without mods: the library page becomes an invitation to open the first one.
export function EmptyMachine({ device, machinePicker, embedded = false }: { device: DeviceProfile; machinePicker?: ReactNode; embedded?: boolean }) {
  const repository = issueRepository()
  return (
    <div className="device-page">
      {machinePicker && <div className="discovery-tools">{machinePicker}</div>}
      <Hero device={device} embedded={embedded}><div className="device-hero-actions"><a className="button button-primary" href={repository + '/blob/main/docs/ADD_A_MACHINE.md'} target="_blank" rel="noreferrer"><Icon name="plus" size={16} />Open a device PR</a><a className="button button-quiet" href="#forum"><Icon name="message" size={16} />Discuss in the forum</a></div></Hero>
      <section className="device-invite"><h2>Be the first to mod the {device.name}</h2><p>Nobody has published a working mod for this machine yet. Modwerk never hosts firmware: every build starts from the stock OS file each owner downloads from Elektron, so the work is in understanding that file and sharing only your own code.</p></section>
      <section className="configuration-section" aria-labelledby="ladder-title">
        <div className="section-title"><h2 id="ladder-title">Road to the first mod</h2><span className="subtle">{stepsDone(device)} of {DEVICE_STEPS.length} done</span></div>
        <ol className="device-ladder">{DEVICE_STEPS.map((step, index) => { const state = device.steps[step.id]; return <li key={step.id} className={'is-' + state}><span className="device-ladder-marker">{state === 'done' ? <Icon name="check" size={14} /> : index + 1}</span><span><strong>{step.title}</strong><small>{step.description}</small></span><span className={'device-step-state is-' + state}>{STEP_LABELS[state]}</span></li> })}</ol>
      </section>
      {device.research?.length ? <section className="configuration-section" aria-labelledby="research-title"><div className="section-title"><h2 id="research-title">Public research</h2><span className="subtle">Credit to its authors</span></div><ul className="device-research">{device.research.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer"><strong>{item.label}</strong><Icon name="arrow" size={13} /></a><p>{item.note}</p></li>)}</ul></section> : null}
      <section className="configuration-section" aria-labelledby="start-title"><div className="section-title"><h2 id="start-title">How to start</h2></div>
        <ol className="device-start">
          <li><strong>Study the stock OS file</strong><p>Work from your own download of the newest OS. Record hashes and structure, never the file’s contents.</p></li>
          <li><strong>Propose a device profile</strong><p>Open a PR with <code>sdk/machines/{device.id}/machine.json</code>: OS releases and hashes, file format, flashing and recovery steps.</p></li>
          <li><strong>Build a core, then a first mod</strong><p>A core reserves memory and shares hooks so mods combine. Your first mod ships with documentation and test evidence.</p></li>
        </ol>
      </section>
      <aside className="risk-note"><strong>Never attach firmware</strong><p>Do not put OS files, memory dumps or extracted Elektron code in a PR, issue or forum post. Share hashes, notes and your own source only.</p></aside>
    </div>
  )
}
