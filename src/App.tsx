import { AccountPage } from './community/AccountPage'
import { ForumPage } from './community/ForumPage'
import './community/forum.css'
import { trackPageView, trackUsage } from './community/usage'
import { PrivacyPage } from './community/PrivacyPage'
import { INDEPENDENCE_NOTICE, FLASHING_RISKS, FIRMWARE_SHARING_NOTICE } from './firmware-notices'
import { assetUrl } from './hosting'
import { ModuleSets } from './components/ModuleSets'
import { ModuleComparison } from './components/ModuleComparison'
import { MODULE_DOCUMENTS_BY_ID } from './catalog/documents'
import { moduleBuildPending } from './catalog/build-support'
import { api } from './community/api'
import { compareModules, downloadCoverage, type ModuleStatistics } from './community/module-statistics'
import { ModulePopularity } from './community/ModulePopularity'
import { selectionConflicts, type ConflictFix } from './catalog/selection-conflicts'
import { CompatibilityPanel } from './components/CompatibilityPanel'
import { useCommunity } from './community/context'
import { SubmissionPage } from './community/SubmissionPage'
import { AdminPage } from './community/AdminPage'
import { PublishedModulePage } from './community/PublishedModulePage'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { flushSync } from 'react-dom'
import { LIBRARY_CATEGORIES, MODULES, resolveSelection } from './catalog/modules'
import { AVAILABLE_MODULES, isModulePaused, moduleAvailabilityError } from './catalog/availability'
import { DETAILS } from './catalog/details'
import { ENGINE_AVAILABLE, DOWNLOADS_ENABLED, DSP_LOADER } from './engine/protocol'
import { useFirmwareBuild } from './hooks/useFirmwareBuild'
import { setWorkspaceReportContext } from './community/report-context'
import { FirmwareBuildPanel } from './components/FirmwareBuildPanel'
import { downloadSelection, parseSelection } from './config/selection'
import { Icon } from './components/Icon'
import { ModulePreview } from './components/ModulePreview'
import { ModuleDetail } from './components/ModuleDetail'
import { ModuleRelease } from './components/ModuleRelease'
import { useModuleUpdates } from './hooks/useModuleUpdates'
import { FaqPage } from './components/FaqPage'
import { MobileMenu } from './components/MobileMenu'
import { SupportButton, SupportDialog } from './components/SupportDialog'
import { PAYPAL_DONATION_URL } from './config/support'

import { useWorkspace } from './hooks/useWorkspace'
import { ConfigurationDialog } from './components/ConfigurationDialog'
import { ConfigurationEffects } from './components/ConfigurationEffects'
function subscribeRoute(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}
// Matches the phone shell breakpoint in styles.css.
const PHONE_LAYOUT = '(max-width: 600px)'
function subscribePhoneLayout(callback: () => void) {
  const media = window.matchMedia(PHONE_LAYOUT)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}
function getPhoneLayout() { return window.matchMedia(PHONE_LAYOUT).matches }
function getRoute() { const route=window.location.hash.slice(1)||'library'; return route==='activity'?'account':route==='remixes'?'module-sets':route.startsWith('remix/')?'module-set/'+route.slice(6):route }

export default function App() {
  const route = useSyncExternalStore(subscribeRoute, getRoute, () => 'library')
  const phoneLayout = useSyncExternalStore(subscribePhoneLayout, getPhoneLayout, () => false)
  useEffect(()=>trackPageView(route),[route])
  const detailModule = route.startsWith('module/') ? AVAILABLE_MODULES.find((module) => module.id === route.slice(7)) : undefined
  const pausedModule = MODULES.find(module => isModulePaused(module.id) && (route === 'module/' + module.id || route === 'community-module/' + module.id))
  const configuration = route === 'configuration'
  const { session, catalog } = useCommunity()
  const communityModule = route.startsWith('community-module/') ? catalog.find(item => item.module_id === route.slice(17) && !isModulePaused(item.module_id)) : undefined
  const forumRoute = route === 'forum' || route.startsWith('forum/') || route.startsWith('forum?')
  const accountRoute = route === 'account' || route.startsWith('account/')
  const communityRoute = forumRoute || accountRoute || route === 'review' || route === 'admin' || route.startsWith('submit') || !!communityModule
  const missingRoute=!forumRoute&&!accountRoute&&!['library',...LIBRARY_CATEGORIES,'module-sets','configuration','faq','review','admin','privacy'].includes(route)&&!route.startsWith('submit')&&!detailModule&&!communityModule&&!route.startsWith('module-set/')
  const filter = LIBRARY_CATEGORIES.find(category => category === route) ?? 'all'
  const categoryLabels = { effects:'Effects', playback:'Playback', machines:'Machines & sequencer', scenes:'Scenes', 'midi-usb':'MIDI & USB', system:'System' }
  const workspace = useWorkspace()
  const { active, ready, firmware, fileState, fileError, firmwareSaved, readFile, clearFile } = workspace
  const selectedIds = active?.moduleIds ?? []
  const firmwareBuild = useFirmwareBuild(workspace.firmwareClient, active, firmware)
  const builtSha = firmwareBuild.state === 'built' ? firmwareBuild.result?.sha256 ?? '' : ''
  useEffect(() => {
    // Issue reports attach the active configuration and, once built here, the image hash (never the image).
    setWorkspaceReportContext({ configurationName: active?.name ?? '', modules: (active?.moduleIds ?? []).map(id => ({ id, version: active?.moduleVersions[id] ?? '' })).filter(item => item.version), keepStockFx2: DSP_LOADER ? active?.keepStockFx2 ?? true : null, build: builtSha })
  }, [active, builtSha])
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchToggleRef = useRef<HTMLButtonElement>(null)
  const searchExpanded = searchOpen || query !== ''
  // Phones show search as an icon; open it within the tap so the keyboard appears.
  function openSearch() { flushSync(() => setSearchOpen(true)); searchRef.current?.focus() }
  function closeSearch() { setQuery(''); flushSync(() => setSearchOpen(false)); searchToggleRef.current?.focus() }
  const [family,setFamily]=useState('all'),[sort,setSort]=useState('collection'),[comparison,setComparison]=useState<string[]>([]),[compareOpen,setCompareOpen]=useState(false)
  const [statistics,setStatistics]=useState<ModuleStatistics[]|null>(null)
  useEffect(()=>{let cancelled=false;if(session.available)void api<ModuleStatistics[]>('/community/summary').then(value=>{if(!cancelled)setStatistics(value)}).catch(()=>{if(!cancelled)setStatistics(null)});return()=>{cancelled=true}},[session.available,route])
  const [dragging, setDragging] = useState(false)
  const [saved, setSaved] = useState(false)
  const [riskAccepted, setRiskAccepted] = useState<{key:string;accepted:boolean}>({key:'',accepted:false})
  const [importError,setImportError]=useState('')
  const importRef=useRef<HTMLInputElement>(null)
  const [configDialog, setConfigDialog] = useState<'create' | 'rename' | 'duplicate' | 'delete' | null>(null)
  const [supportOpen, setSupportOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const libraryNavRef = useRef<HTMLElement>(null)
  // On phones the library nav is a horizontal strip; keep the current section in view.
  useEffect(() => {
    const active = libraryNavRef.current?.querySelector('a.active')
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    else libraryNavRef.current?.scrollTo({ left: 0 })
  }, [route])
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 });document.title=(detailModule?.name??(forumRoute?'Forum':accountRoute?'Account':route==='faq'?'FAQ':route==='privacy'?'Privacy':route==='configuration'?'Configuration':route.startsWith('submit')?'Submit a module':(route==='review'||route==='admin')?'Admin workspace':route.startsWith('module-set')?'Module sets':'Module library'))+' · Octamod' }, [route,detailModule?.name,forumRoute,accountRoute])
  const selection = resolveSelection(selectedIds)
  const availabilityError = moduleAvailabilityError(selectedIds)
  const conflicts = selectionConflicts(selectedIds, DSP_LOADER && (active?.keepStockFx2 ?? true))
  const visibleModules = AVAILABLE_MODULES.filter((module) =>
    (filter === 'all' || module.category === filter)
    && (family==='all'||DETAILS[module.id].family===family)
    && (module.name + ' ' + module.description + ' ' + module.authorName + ' ' + module.author).toLowerCase().includes(query.toLowerCase().trim()),
  ).sort((a,b)=>compareModules(a,b,sort,statistics))
  const displayedModules = detailModule ? [detailModule] : route === 'library' || LIBRARY_CATEGORIES.includes(route as typeof LIBRARY_CATEGORIES[number]) ? visibleModules : []
  const { viewed: viewedModuleVersions, baseline: moduleBaseline } = useModuleUpdates(displayedModules, MODULES, detailModule?.id)

  function toggleModule(id: string) { workspace.toggleModule(id); setSaved(false); setRiskAccepted({key:'',accepted:false}) }
  function fixConflict(fix: ConflictFix) {
    for (const id of fix.removeIds ?? []) if (selectedIds.includes(id)) workspace.toggleModule(id)
    if (fix.keepStockFx2 !== undefined) workspace.setKeepStockFx2(fix.keepStockFx2)
    setSaved(false); setRiskAccepted({key:'',accepted:false})
  }
  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file) void readFile(file)
  }
  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false)
    if (event.dataTransfer.files.length !== 1) { workspace.setFileError('Choose one firmware file at a time.'); return }
    void readFile(event.dataTransfer.files[0])
  }
  function saveSelection() { downloadSelection(selectedIds, firmware, active?.name, DSP_LOADER && (active?.keepStockFx2 ?? true), active?.moduleVersions); setSaved(true); trackUsage('configuration_exported') }
  async function importSelection(event: ChangeEvent<HTMLInputElement>) {
    const file=event.currentTarget.files?.[0]; event.currentTarget.value=''; if(!file)return
    setImportError('')
    try {
      if(file.size>32*1024)throw new Error('Configuration backups must be smaller than 32 KB.')
      const imported=parseSelection(await file.text())
      workspace.importConfiguration(imported.name,imported.moduleIds,imported.keepStockFx2,imported.moduleVersions)
      setSaved(false);setRiskAccepted({key:'',accepted:false});window.location.assign('#configuration')
    }catch(error){setImportError(error instanceof Error?error.message:'Could not import this configuration.')}
  }
  function changeConfiguration(id: string) { workspace.selectConfiguration(id); setSaved(false); setRiskAccepted({key:'',accepted:false}); window.location.assign('#configuration') }
  function submitConfigurationDialog(name: string) {
    if (configDialog === 'delete') workspace.deleteConfiguration()
    else if (configDialog === 'rename') workspace.renameConfiguration(name)
    else workspace.createConfiguration(name, configDialog === 'duplicate')
    setSaved(false); setRiskAccepted({key:'',accepted:false}); window.location.assign('#configuration')
  }

  // Phones show the independence notice as a page footer; wider layouts keep it above the content.
  const projectNotice = <aside className="project-notice" aria-label="Project independence"><p>{INDEPENDENCE_NOTICE}</p><a href={assetUrl('licenses/THIRD_PARTY_NOTICES.html')} target="_blank" rel="noreferrer">Copyright &amp; licence notices</a></aside>

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); mainRef.current?.focus() }}>Skip to content</a>
      <aside className="sidebar" aria-label="App sidebar">
        <a className="app-brand" href="#library"><img src={import.meta.env.BASE_URL + 'favicon.svg'} width="34" height="34" alt="" /><span>Octamod<small>Firmware configurator</small></span></a>
        <div className="sidebar-section-label">Library</div>
        <nav className="sidebar-nav" aria-label="Module library" ref={libraryNavRef}>
          <a href="#library" className={route === 'library' ? 'active' : ''} aria-current={route === 'library' ? 'page' : undefined}><Icon name="grid" /><span>All modules</span><small>{AVAILABLE_MODULES.length}</small></a>
          {LIBRARY_CATEGORIES.map(category => {
            const count = AVAILABLE_MODULES.filter(module => module.category === category).length
            return count > 0 && <a key={category} href={'#'+category} onClick={()=>setFamily('all')} className={!detailModule && filter === category ? 'active' : ''} aria-current={!detailModule && filter === category ? 'page' : undefined}><Icon name={category==='scenes'?'grid':category==='effects'||category==='midi-usb'?'wave':'sliders'} /><span>{category==='machines'?'Machines':categoryLabels[category]}</span><small>{count}</small></a>
          })}
          <a href="#module-sets" className={route.startsWith('module-set')?'active':''}><Icon name="file"/><span>Module sets</span></a>
        </nav>
        <div className="sidebar-section-label configuration-label"><span>Configurations</span><button className="icon-button" aria-label="New configuration" disabled={!ready} onClick={() => setConfigDialog("create")}><Icon name="plus" size={18} /></button></div>
        <nav className="sidebar-nav configuration-nav" aria-label="Saved configurations">{workspace.configurations.map(item => <button key={item.id} className={item.id === active?.id ? 'active' : ''} aria-pressed={item.id === active?.id} onClick={() => changeConfiguration(item.id)}><Icon name="file" /><span>{item.name}</span><small>{item.moduleIds.length}</small></button>)}</nav>
        <div className="sidebar-section-label community-label">Community & help</div><nav className="sidebar-nav community-nav" aria-label="Community and help"><a href="#forum" className={forumRoute?'active':''}><Icon name="message"/><span>Forum</span></a><a href="#account" className={accountRoute?'active':''}><Icon name="shield"/><span>{session.user?.verified?'Your account':'Sign in / register'}</span></a><a href="#submit" className={route.startsWith('submit') ? 'active' : ''}><Icon name="plus"/><span>Submit a module</span></a>{session.admin && <a href="#admin" className={route === 'admin'||route === 'review' ? 'active' : ''}><Icon name="shield"/><span>Admin workspace</span></a>}<a href="#faq" className={route === 'faq' ? 'active' : ''} aria-current={route === 'faq' ? 'page' : undefined}><Icon name="help" /><span>FAQ<span className="help-guide-label"> & flashing guide</span></span></a></nav>
        <div className="sidebar-spacer" />
        <a className="sidebar-build" href="#configuration" aria-label={firmware ? 'Base firmware ready — View configuration' : undefined} aria-describedby={firmware ? 'sidebar-firmware-status' : undefined}>
          <span className={'status-dot ' + (firmware ? 'verified' : '')} />
          <span className="sidebar-build-copy"><strong>{firmware ? 'Base firmware ready' : 'Choose firmware'}</strong><small id="sidebar-firmware-status">{firmware ? 'OS 1.40C · ' + (firmwareSaved ? 'saved on device' : 'this session') : 'Start with your own OS 1.40C file.'}</small></span>
          <Icon name="arrow" size={14} />
        </a>
        <div className="sidebar-footer"><div className="sidebar-privacy"><Icon name="shield" size={14} /><span>Firmware stays on your device</span></div>{PAYPAL_DONATION_URL && <SupportButton onClick={() => setSupportOpen(true)} />}</div>
      </aside>
      {compareOpen&&<ModuleComparison ids={comparison} selected={selectedIds} onToggle={toggleModule} onClose={()=>setCompareOpen(false)}/>}
      {configDialog && <ConfigurationDialog mode={configDialog} initialName={configDialog === 'create' ? '' : configDialog === 'duplicate' ? (active?.name ?? '') + ' copy' : active?.name ?? ''} onSubmit={submitConfigurationDialog} onClose={() => setConfigDialog(null)} />}
      {supportOpen && <SupportDialog url={PAYPAL_DONATION_URL} onClose={() => setSupportOpen(false)} />}
      <div className="workspace">
        <header className="app-toolbar">
          <a className="toolbar-brand" href="#library"><img src={import.meta.env.BASE_URL + 'favicon.svg'} width="30" height="30" alt="" /><span>Octamod</span></a>
          <div className="toolbar-title"><Icon name={route === 'faq' ? 'help' : configuration ? 'file' : 'grid'} size={17} /><span>{route === 'faq' ? 'FAQ & flashing guide' : configuration ? 'Configuration' : route === 'privacy' ? 'Privacy' : communityRoute ? 'Community' : route.startsWith('module-set') ? 'Module sets' : 'Modules'}</span>{detailModule && <><span className="breadcrumb-divider">/</span><strong>{detailModule.name}</strong></>}<span className="preview-badge">Preview</span></div>
          {['library',...LIBRARY_CATEGORIES,'module-sets'].includes(route) && <><label className={'search' + (searchExpanded ? ' is-open' : '')}><Icon name="search" size={15} /><input ref={searchRef} type="search" aria-label={route==='module-sets'?'Search module sets':'Search modules'} placeholder={route==='module-sets'?'Search sets':'Search modules'} value={query} onChange={(event) => setQuery(event.target.value)} onBlur={() => { if (!query) setSearchOpen(false) }} onKeyDown={(event) => { if (phoneLayout && event.key === 'Escape') closeSearch() }} /></label><button ref={searchToggleRef} type="button" className="toolbar-icon search-toggle" aria-label={route==='module-sets'?'Search module sets':'Search modules'} onClick={openSearch}><Icon name="search" size={20} /></button><button type="button" className="search-cancel" onClick={closeSearch}>Cancel</button></>}
          <MobileMenu route={route} selectedCount={selection.length} admin={session.admin} onSupport={PAYPAL_DONATION_URL ? () => setSupportOpen(true) : undefined} />
          <a className="configuration-button" href="#configuration" aria-label={"Open configuration, " + selection.length + " modules selected"}><Icon name="sliders" size={16} /><span>Configuration</span><span className="toolbar-count">{selection.length}</span></a>
        </header>
        <main className="workspace-content" id="main-content" ref={mainRef} tabIndex={-1}>
          {!phoneLayout && projectNotice}
          {workspace.storageError && <div className="file-error" role="alert">{workspace.storageError} Export important configurations before closing this tab.</div>}
          {route === 'faq' ? <FaqPage /> : !ready ? <div className="loading-panel" role="status">Opening your workspace…</div> : <>
          {missingRoute?<div className="no-results"><h1>{pausedModule ? 'Module temporarily unavailable' : 'Page not found'}</h1><p>{pausedModule ? pausedModule.name + ' has been temporarily removed due to reported audio crackling.' : 'This module or page is not in the current catalog.'}</p><a className="button button-quiet" href="#library">Open module library</a></div>:route==='module-sets'||route.startsWith('module-set/')?<ModuleSets query={query} id={route.startsWith('module-set/')?route.slice(11):undefined} onUse={(name,ids)=>{workspace.importConfiguration(name,ids);window.location.assign('#configuration')}}/>:forumRoute ? <ForumPage key={route} route={route} configuration={active} onCopy={config=>{workspace.importConfiguration(config.name,config.moduleIds,config.keepStockFx2,config.moduleVersions);window.location.assign('#configuration')}}/> : accountRoute ? <AccountPage key={route.split('/').slice(0,2).join('/')} route={route}/> : route === 'privacy' ? <PrivacyPage /> : route.startsWith('submit') ? <SubmissionPage key={route} moduleId={route.split('/')[1] ?? ''} /> : route === 'review'||route === 'admin' ? <AdminPage /> : communityModule ? <PublishedModulePage module={communityModule} /> : detailModule ? <ModuleDetail key={detailModule.id} module={detailModule} selected={selectedIds.includes(detailModule.id)} onToggle={() => toggleModule(detailModule.id)} /> : configuration ? (
            <div className="configuration-page">
              <div className="page-heading"><div><p className="page-kicker">YOUR WORKSPACE</p><h1>{active?.name}</h1><p>Changes save automatically on this device. Configurations use current module versions.</p></div><span className="pill">OS 1.40C</span></div>
              <div className="configuration-actions"><select aria-label="Choose configuration" value={active?.id ?? ''} onChange={event => changeConfiguration(event.target.value)}>{workspace.configurations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="button button-primary" onClick={() => setConfigDialog('create')}><Icon name="plus" size={16} />New</button><button className="button button-quiet" onClick={() => setConfigDialog('rename')}>Rename</button><button className="button button-quiet" onClick={() => setConfigDialog('duplicate')}>Duplicate</button><button className="button button-quiet" onClick={() => setConfigDialog('delete')}>Delete</button><button className="button button-quiet" onClick={()=>importRef.current?.click()}>Import JSON</button><a className="button button-quiet" href="#forum/new?category=configs">Share in forum</a></div><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={event=>void importSelection(event)} aria-label="Import configuration backup"/>{importError&&<p className="file-error" role="alert">{importError}</p>}
              <aside className="risk-note" role="note" aria-labelledby="project-compatibility-title">
                <strong id="project-compatibility-title">Start with a fresh Octatrack project</strong>
                <p>After installing a new firmware build, create and open a fresh project on your Octatrack. Back up your existing projects first.</p>
                <p>If your modules replace stock effects, older projects that use those effects are not compatible with the modified firmware. Removing stock FX2 effects can also make existing projects incompatible.</p>
              </aside>
              <input ref={inputRef} type="file" accept=".bin" onChange={chooseFile} hidden aria-label="Choose base firmware" />
              <CompatibilityPanel ids={selectedIds} keepStockFx2={DSP_LOADER && (active?.keepStockFx2??true)} buildState={firmwareBuild.state} onFix={fixConflict}/>
              <section className="configuration-section" aria-labelledby="firmware-title"><div className="section-title"><h2 id="firmware-title">Base firmware</h2><span className="subtle">Read locally</span></div>
                <div className={'firmware-drop ' + (dragging ? 'is-dragging ' : '') + (fileState === 'ready' ? 'is-verified' : '')} onDragOver={(event) => event.preventDefault()} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDrop={dropFile} aria-busy={fileState === 'reading'}>
                  <span className="file-symbol"><Icon name={firmware ? 'check' : 'file'} size={26} /></span>
                  <div className="file-copy" aria-live="polite"><strong>{firmware ? firmware.name : fileState === 'reading' ? 'Checking your firmware…' : 'Original Octatrack OS 1.40C'}</strong><span>{firmware ? 'SHA-256 verified · ' + (firmware.bytes / 1024).toFixed(0) + ' KB' : 'Drop your .bin file here, or choose it from your device.'}</span></div>
                  <button className="button button-quiet" onClick={() => inputRef.current?.click()}>{firmware ? 'Change file' : 'Choose file'}</button>
                </div>
                {fileError && <p className="file-error" role="alert">{fileError}</p>}
                <div className="file-footnote"><span>{firmware ? (firmwareSaved ? 'Saved on this device and verified again each time you return.' : 'Verified for this session. Saving on this device…') : 'Saved in this browser after verification. Never uploaded.'}</span>{(firmware || fileState === 'reading') && <button className="text-button" onClick={clearFile}>Remove from device</button>}</div>
                <p className="firmware-help"><a href="#faq">Where do I get the .bin? Read the FAQ & flashing guide <Icon name="arrow" size={14} /></a></p>
              </section>
              <section className="configuration-section" aria-labelledby="selection-title"><div className="section-title"><h2 id="selection-title">Selected modules <span className="subtle">{selection.length}</span></h2><a className="text-button" href="#library">Browse modules <Icon name="plus" size={14} /></a></div>
                {availabilityError && <p className="file-error" role="alert">{availabilityError}</p>}
                {selection.length ? <ul className="selected-list">{selection.map((module) => <li key={module.id}><a className="selected-module-link" href={'#module/' + module.id}><ModulePreview id={module.id} compact /><span><strong>{module.name}</strong><small>{isModulePaused(module.id) ? 'Temporarily unavailable' : module.detail} · {module.authorName}</small></span></a><button className="icon-button" aria-label={'Remove ' + module.name} onClick={() => toggleModule(module.id)}><Icon name="close" size={17} /></button></li>)}</ul> : <div className="selection-empty"><Icon name="grid" size={26} /><strong>No modules selected</strong><p>Find something in the library and add it to your configuration.</p><a className="button button-quiet" href="#library">Browse modules</a></div>}
              </section>
              {DSP_LOADER && <section className="configuration-section chooser-options"><h2>Effect menus</h2><label><input type="checkbox" checked={active?.keepStockFx2??true} onChange={event=>workspace.setKeepStockFx2(event.target.checked)}/><span><strong>Keep stock FX2 effects</strong><small>Keep the original FX2 effects alongside your modules.</small></span></label></section>}
              <ConfigurationEffects ids={selectedIds} keepStockFx2={active?.keepStockFx2 ?? true} build={firmwareBuild} />
              <aside className="risk-note"><strong>Before you flash</strong><p>{FLASHING_RISKS} Back up your projects and samples, review the module test records, and keep the original OS. Flash at your own risk.</p><p>{FIRMWARE_SHARING_NOTICE}</p><label className="risk-accept"><input type="checkbox" checked={riskAccepted.key===firmwareBuild.key&&riskAccepted.accepted} onChange={event => setRiskAccepted({key:firmwareBuild.key,accepted:event.target.checked})} />I understand the risks of flashing custom firmware.</label></aside>
              <FirmwareBuildPanel build={firmwareBuild} available={ENGINE_AVAILABLE} downloadsEnabled={DOWNLOADS_ENABLED} firmwareReady={!!firmware} moduleCount={selection.length} riskAccepted={riskAccepted.key===firmwareBuild.key&&riskAccepted.accepted} configurationName={active?.name??'Octamod configuration'} onExport={saveSelection} exported={saved}/>

            </div>
          ) : (
            <div className="library-page">
              <div className="page-heading"><div><p className="page-kicker">OCTAMOD / COLLECTION</p><h1>{filter === 'all' ? 'Module library' : categoryLabels[filter]}</h1><p>A different way to play your Octatrack.</p></div><span className="library-total">{visibleModules.length} modules</span></div>
              {!!conflicts.length && <a className="selection-conflict-link" href="#configuration"><Icon name="sliders" size={18}/><span><strong>Your selection needs a change</strong><small>Some modules cannot run together. Choose a compatible set in your configuration.</small></span><Icon name="arrow" size={18}/></a>}
              <div className="library-subheading"><span>{query.trim() ? 'Results for “' + query.trim() + '”' : filter === 'all' ? 'Explore the collection' : filter === 'effects' ? 'Filters, texture & space' : 'New ways to play'}</span><span className="subtle">Octatrack · OS 1.40C</span></div>
              <div className="discovery-tools"><label>Type<select value={family} onChange={event=>setFamily(event.target.value)}><option value="all">All types</option>{Array.from(new Set(AVAILABLE_MODULES.map(m=>DETAILS[m.id].family))).map(value=><option key={value}>{value}</option>)}</select></label><label>Sort<select value={sort} onChange={event=>setSort(event.target.value)}><option value="collection">Collection order</option><option value="recent">Recently added</option><option value="name">Name A–Z</option><option value="author">Author</option><option value="rated">Highest rated</option><option value="liked">Most liked</option><option value="downloaded">Most downloaded</option></select></label><div className="discovery-actions"><button className="button button-quiet" disabled={comparison.length<2} onClick={()=>setCompareOpen(true)}>Compare{comparison.length?' ('+comparison.length+')':''}</button><a className="button button-primary" href="#configuration"><Icon name="sliders" size={16}/>Build firmware</a></div></div>
              <div className="module-grid">{visibleModules.map((module) => {
                const selected = selectedIds.includes(module.id)
                const stats=statistics?.find(item=>item.module_id===module.id),record=MODULE_DOCUMENTS_BY_ID[module.id]
                return <article key={module.id} className={'module-card ' + (selected ? 'is-selected' : '')}>
                  <a href={'#module/' + module.id} className="module-cover" aria-label={'View ' + module.name}><ModulePreview id={module.id} /><div className="hover-info"><span>{module.description}</span><strong>Explore module <Icon name="arrow" size={15} /></strong></div>{selected && <span className="selected-badge" aria-label="Selected"><Icon name="check" size={12} /></span>}</a>
                  <div className="module-card-body"><div className="module-card-title"><div className="module-card-heading"><a href={'#module/' + module.id}>{module.name}</a><ModuleRelease module={module} viewedVersion={viewedModuleVersions[module.id]} baseline={moduleBaseline} /></div><button className={'add-button ' + (selected ? 'is-added' : '')} aria-label={(selected ? 'Remove ' : 'Add ') + module.name + (selected ? ' from configuration' : ' to configuration')} aria-pressed={selected} onClick={() => toggleModule(module.id)}><Icon name={selected ? 'check' : 'plus'} size={15} /><span>{selected ? 'Added' : 'Add'}</span></button></div><div className="card-credit"><a href={module.authorUrl} target="_blank" rel="noreferrer">{module.authorName}</a><span>{module.detail}</span></div><div className="card-description">{module.description}</div><div className="card-bottom"><span>{DETAILS[module.id].family}</span><span className="unrated"><Icon name="star" size={11} />{stats?.count&&stats.average!==null?stats.average.toFixed(1)+' ('+stats.count+')':'Unrated'}</span></div><ModulePopularity statistics={stats}/><div className="card-proof"><span>{moduleBuildPending(module.id)?'Build verification pending':record.tests.hardwareStatus==='reported'?'Hardware test reported':record.tests.hardwareStatus!=='untested'?'Earlier hardware evidence':'Emulator evidence'}</span><label><input type="checkbox" checked={comparison.includes(module.id)} disabled={comparison.length>=3&&!comparison.includes(module.id)} onChange={()=>setComparison(current=>current.includes(module.id)?current.filter(id=>id!==module.id):[...current,module.id])}/>Compare<span className="sr-only"> {module.name}</span></label></div></div>
                </article>
              })}</div>
              <p className="popularity-note">{statistics ? downloadCoverage(statistics[0]?.downloadsStarted) : 'Popularity counts are currently unavailable.'}</p>
              {!visibleModules.length && <div className="no-results"><Icon name="search" size={30} /><h2>No modules found</h2><p>Try another name, effect or author.</p><button className="button button-quiet" onClick={() => {setQuery('');setFamily('all')}}>Clear search</button></div>}
              {!!catalog.filter((item,index,items)=>!MODULES.some(module=>module.id===item.module_id)&&items.findIndex(other=>other.module_id===item.module_id)===index).length && <section className="published-collection"><h2>Community modules</h2><div className="module-grid">{catalog.filter((item,index,items)=>!MODULES.some(module=>module.id===item.module_id)&&items.findIndex(other=>other.module_id===item.module_id)===index).sort((a,b)=>compareModules({id:a.module_id,name:a.title,authorName:a.author,addedAt:a.added_at??undefined},{id:b.module_id,name:b.title,authorName:b.author,addedAt:b.added_at??undefined},sort,statistics)).map(item=><article className="published-card" key={item.module_id}><span className="pill">Reviewed contribution</span><h2><a href={'#community-module/'+item.module_id}>{item.title}</a></h2><p>{item.description}</p><ModulePopularity statistics={statistics?.find(stats=>stats.module_id===item.module_id)}/><a className="text-button" href={'#community-module/'+item.module_id}>View module →</a></article>)}</div></section>}
              <div className="library-note"><span className="status-dot" /><p>This catalog follows an experimental build. Review each module before preparing a configuration.</p></div>
            </div>
          )}
          </>}
          {phoneLayout && projectNotice}
        </main>
        <footer className="status-bar"><a className="privacy-link" href="#privacy">Privacy</a><span><span className={'status-dot ' + (firmware ? 'verified' : '')} />{firmware ? 'OS 1.40C verified' : 'No base firmware selected'}</span><span className="status-build" role="status">{workspace.saving ? "Saving…" : workspace.storageError ? "Changes not saved" : "Workspace saved on device"}</span><a href="#configuration" aria-live="polite">{selection.length} {selection.length === 1 ? 'module' : 'modules'} selected <Icon name="arrow" size={12} /></a></footer>
      </div>
    </div>
  )
}
