import { AccountPage } from './community/AccountPage'
import { SignupWelcome } from './community/SignupWelcome'
import { HardwareFeedbackReminder } from './community/HardwareFeedbackReminder'
import { HardwareFeedbackCheckIn } from './community/HardwareFeedbackCheckIn'
import { NotificationBell } from './community/NotificationBell'
import { PublicAnnouncement } from './community/PublicAnnouncement'
import { useMembersOnline } from './community/useMembersOnline'
import { MembersOnlineChip } from './community/MembersOnline'
import { DeveloperPage } from './community/DeveloperPage'
import { MemberGate } from './community/MemberGate'
import { ForumPage } from './community/ForumPage'
import { ForumShoutbox } from './community/ForumShoutbox'
import './community/forum.css'
import { trackPageView, trackUsage } from './community/usage'
import { LegalPage } from './legal/LegalPage'
import { PrivacyPage } from './community/PrivacyPage'
import { INDEPENDENCE_NOTICE } from './firmware-notices'
import { assetUrl } from './hosting'
import { contributorSearchText } from './catalog/module-authors'
import { getRoute, moduleHref } from './routing'
import { setPageMetadata } from './page-metadata'
import { HOME_DESCRIPTION, HOME_TITLE } from './site-metadata'
import { ModuleSets } from './components/ModuleSets'
import { ModuleComparison } from './components/ModuleComparison'
import { api } from './community/api'
import { compareModules, DEFAULT_MODULE_SORT, MODULE_STATISTICS_CHANGED, type ModuleStatistics } from './community/module-statistics'
import { ModulePopularity } from './community/ModulePopularity'
import { selectionConflicts, type ConflictFix } from './catalog/selection-conflicts'
import { addBlocks } from './catalog/add-blocks'
import { useCommunity } from './community/context'
import { hasBetaAccess } from './community/beta-access'
import { SubmissionPage } from './community/SubmissionPage'
import { AdminPage } from './community/AdminPage'
import { PublishedModulePage } from './community/PublishedModulePage'
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { flushSync } from 'react-dom'
import { LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS, MODULES, resolveSelection, type ModuleCategory } from './catalog/modules'
import { AVAILABLE_MODULES, availableModules, isModuleAvailable, isModulePaused, moduleAvailabilityError } from './catalog/availability'
import { DETAILS } from './catalog/details'
import { readCatalogBrowse, saveCatalogBrowse, type CatalogBrowse } from './catalog/catalog-browse'
import { ENGINE_AVAILABLE, DOWNLOADS_ENABLED, DSP_LOADER, USB_LINK } from './engine/protocol'
import { useFirmwareBuild } from './hooks/useFirmwareBuild'
import { issueRepository, setWorkspaceReportContext } from './community/report-context'
import { FirmwareBuildPanel } from './components/FirmwareBuildPanel'
import { OctatrackUpdate, type PrepareUpdate, type ReadInventory, type StressTest } from './components/OctatrackUpdate'
import { YourOctatrack } from './components/YourOctatrack'
import { StockEffects } from './components/StockEffects'
import { OctatrackActivity, OctatrackStatus } from './components/OctatrackStatus'
import { BaseInstallDialog } from './components/BaseInstallDialog'
import { OctatrackLink } from './engine/elekloader/octatrack-link'
import { useBaseInstallPrompt } from './hooks/useBaseInstallPrompt'
import { OctatrackLinkContext, useOctatrackBase } from './hooks/useOctatrackLink'
import { DIGI_DOWNLOADS_ENABLED } from './engine/elekloader/protocol'
import { USB_AUDIO_MODULE, usbAudioLayout, type UsbAudioConfiguration } from './config/usb-audio'
import { downloadSelection, parseSelection } from './config/selection'
import { Icon } from './components/Icon'
import { ModulePreview } from './components/ModulePreview'
import { ModuleDetail } from './components/ModuleDetail'
import { useModuleUpdates } from './hooks/useModuleUpdates'
import { FaqPage } from './components/FaqPage'
import { CreditsPage } from './components/CreditsPage'
import { ProjectsPage } from './projects/ProjectsPage'
import { PROJECT_DESCRIPTION, PROJECT_TITLE, PROJECT_PREVIEW_IMAGE, PROJECT_PREVIEW_ALT } from './projects/projects'
import { MobileMenu } from './components/MobileMenu'
import { MachineSwitcher } from './devices/MachineSwitcher'
import { AccountMenu } from './community/AccountMenu'
import { MachineLibrary, DigiConfiguration, DigiModDetail } from './devices/MachinePages'
import { LibraryDock } from './components/LibraryDock'
import { ALL_MACHINES, DEVICES_BY_ID, deviceHref, parseDeviceRoute, rememberDevice, rememberedDevice, type DeviceProfile } from './devices/registry'
import { DIGI_MODS, isDigiDevice, type DigiMod } from './devices/digi-mods'
import { configurationDevice, type Configuration } from './config/workspace'
import './devices/devices.css'
import { SupportButton, SupportDialog } from './components/SupportDialog'
import { SUPPORT_URL } from './config/support'

import { useWorkspace } from './hooks/useWorkspace'
import { usePhoneToolbar } from './hooks/usePhoneToolbar'
import { ConfigurationDialog } from './components/ConfigurationDialog'
import { ConfigurationReportDialog } from './community/ConfigurationReport'
import { ConfigurationEffects } from './components/ConfigurationEffects'
import { ConfigurationHeader, RiskAcceptance } from './components/ConfigurationLayout'
// The panel reads every recorded declaration check, megabytes of data, so it loads with the configuration page only.
const CompatibilityPanel = lazy(() => import('./components/CompatibilityPanel').then(module => ({ default: module.CompatibilityPanel })))
const FirmwareFeedbackPreview = import.meta.env.DEV ? lazy(() => import('./components/FirmwareFeedbackPreview')) : () => null
const firmwareFeedbackPreview = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'firmware-feedback'
// Dev previews of the USB card and the base install prompt against a pretend unit.
const usbPreview = import.meta.env.DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('preview') : null
const usbLinkPreview = usbPreview === 'usb-link' || usbPreview === 'base-install'
// Phones and tablets get no USB workflow (iOS has no WebUSB, and the card install needs a computer anyway).
const touchOnly = typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches
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
const SIDEBAR_CATEGORIES = LIBRARY_CATEGORIES.filter(category => category === 'standalone' || AVAILABLE_MODULES.some(module => module.category === category) || DIGI_MODS.some(mod => mod.libraryCategory === category))
function defaultRoute() { const device=rememberedDevice(); return device?deviceHref(device).slice(1):ALL_MACHINES }
// With no route in the URL, open the remembered machine's library (or All machines on a first visit).
function getAppRoute() { return getRoute(defaultRoute()) }

export default function App() {
  const route = useSyncExternalStore(subscribeRoute, getAppRoute, () => 'library')
  const moduleRoute = route.split('?')[0]
  const phoneLayout = useSyncExternalStore(subscribePhoneLayout, getPhoneLayout, () => false)
  const presence = useMembersOnline(), online = presence?.online ?? null
  useEffect(()=>trackPageView(route),[route])
  const { session, developer, catalog } = useCommunity()
  const betaAccess = hasBetaAccess(session), accessibleModules = availableModules(betaAccess)
  const detailModule = moduleRoute.startsWith('module/') ? accessibleModules.find((module) => module.id === moduleRoute.slice(7)) : undefined
  const pausedModule = MODULES.find(module => isModulePaused(module.id) && !isModuleAvailable(module.id, betaAccess) && (moduleRoute === 'module/' + module.id || moduleRoute === 'community-module/' + module.id))
  const configuration = route === 'configuration'
  const communityModule = moduleRoute.startsWith('community-module/') ? catalog.find(item => item.module_id === moduleRoute.slice(17) && isModuleAvailable(item.module_id, betaAccess)) : undefined
  const projectsRoute = moduleRoute === 'projects'
  const devicesRoute = route === 'devices'
  const machineRoute = parseDeviceRoute(moduleRoute)
  const digiDevice = machineRoute && isDigiDevice(machineRoute.device.id) ? machineRoute.device as DeviceProfile & { id: DigiMod['device'] } : undefined
  const digiMod = digiDevice && machineRoute?.view === 'module' ? DIGI_MODS.find(mod => mod.device === digiDevice.id && mod.id === machineRoute.moduleId) : undefined
  const machineView = !machineRoute ? undefined : machineRoute.view === 'module' ? (digiMod ? 'module' : undefined) : machineRoute.view === 'configuration' ? (digiDevice ? 'configuration' : undefined) : !machineRoute.category || LIBRARY_CATEGORIES.includes(machineRoute.category as ModuleCategory) ? 'library' : undefined
  const forumRoute = route === 'forum' || route.startsWith('forum/') || route.startsWith('forum?')
  const developerRoute = route === 'developer' || route.startsWith('developer/')
  const accountRoute = route === 'account' || route.startsWith('account/')
  // One link to the unit for the whole site: it connects by itself whenever an allowed Octatrack is plugged in.
  // The builder's prepareUpdate and the test runner's stressTest join it once they exist.
  const [usbKit, setUsbKit] = useState<{ link: OctatrackLink; prepareUpdate?: PrepareUpdate; readInventory?: ReadInventory; stressTest?: StressTest } | null>(() => USB_LINK && !touchOnly && !usbLinkPreview ? { link: new OctatrackLink() } : null)
  useEffect(() => { if (import.meta.env.DEV && usbLinkPreview) void import('./dev/octatrack-link-fake').then(fake => setUsbKit(fake.previewKit())) }, [])
  const usbLink = usbKit?.link
  const usbBase = useOctatrackBase(usbLink ?? null)
  const yourOctatrackRoute = route === 'your-octatrack'
  const [baseInstall, setBaseInstall] = useState<'manual' | 'preview' | null>(usbPreview === 'base-install' ? 'preview' : null)
  // At release, once per member wherever they are, except on account, sign-in, admin and legal pages.
  const baseInstallPrompt = useBaseInstallPrompt(session.user?.verified ? session.user.id : null, !!usbLink && !usbLinkPreview && !accountRoute && !developerRoute && !route.startsWith('submit') && !['admin', 'review', 'privacy', 'impressum', 'community-rules', 'report-content'].includes(route))
  useEffect(()=>{if(developerRoute&&!route.startsWith('developer/complete')&&developer&&!developer.user)window.location.replace('#account/developer')},[developerRoute,route,developer])
  const communityRoute = developerRoute || forumRoute || accountRoute || route === 'review' || route === 'admin' || route.startsWith('submit') || !!communityModule
  const allCategory = route.startsWith(ALL_MACHINES + '/') && LIBRARY_CATEGORIES.includes(route.slice(4) as ModuleCategory) ? route.slice(4) as ModuleCategory : undefined
  const allRoute = route === ALL_MACHINES || !!allCategory
  const missingRoute=route!=='your-octatrack'&&!projectsRoute&&!allRoute&&!devicesRoute&&!machineView&&route!=='octatrack'&&!route.startsWith('device/')&&!forumRoute&&!accountRoute&&!developerRoute&&!['library',...LIBRARY_CATEGORIES,'module-sets','configuration','faq','credits','review','admin','privacy','impressum','community-rules','report-content'].includes(route)&&!route.startsWith('submit')&&!detailModule&&!communityModule&&!route.startsWith('module-set/')
  const filter = LIBRARY_CATEGORIES.find(category => category === route) ?? 'all'
  const octatrackRoute = route === 'library' || route === 'configuration' || route === 'module-sets' || route.startsWith('module') || LIBRARY_CATEGORIES.includes(route as typeof LIBRARY_CATEGORIES[number])
  // The selected machine follows library routes and is remembered for the rest of the app.
  const remembered = rememberedDevice()
  // All machines is a library view; machine-specific panels fall back to the last machine (or the Octatrack).
  const allMachines = allRoute || (!machineView && !octatrackRoute && remembered === ALL_MACHINES)
  const currentDevice = DEVICES_BY_ID[machineView ? machineRoute!.device.id : octatrackRoute ? 'octatrack' : remembered && remembered !== ALL_MACHINES ? remembered : 'octatrack']
  const machineHasMods = !allMachines && (currentDevice.status === 'available' || currentDevice.status === 'preview')
  useEffect(() => { if (allRoute) rememberDevice(ALL_MACHINES); else if (machineView || octatrackRoute) rememberDevice(currentDevice.id) }, [allRoute, machineView, octatrackRoute, currentDevice.id])
  // The machine overview now lives on the forum's front page.
  useEffect(() => { if (devicesRoute) window.location.replace('#forum'); else if (route === 'octatrack') window.location.replace('#library'); else if (route.startsWith('device/')) window.location.replace(DEVICES_BY_ID[route.slice(7)] ? deviceHref(route.slice(7)) : '#devices') }, [route, devicesRoute])
  // The sidebar keeps one shape on every machine: the same categories, counted for the current selection.
  const libraryCount = (category?: ModuleCategory) => (allMachines || currentDevice.id === 'octatrack' ? accessibleModules.filter(module => !category || module.category === category).length : 0) + DIGI_MODS.filter(mod => (allMachines || mod.device === currentDevice.id) && (!category || mod.libraryCategory === category)).length
  const libraryHref = (category?: ModuleCategory) => allMachines ? '#' + ALL_MACHINES + (category ? '/' + category : '') : currentDevice.id === 'octatrack' ? '#' + (category ?? 'library') : deviceHref(currentDevice.id, category ?? '')
  const libraryCategory = allMachines ? allCategory : currentDevice.id === 'octatrack' ? (detailModule || filter === 'all' ? undefined : filter) : machineRoute?.category
  const onLibrary = allMachines ? allRoute : currentDevice.id === 'octatrack' ? route === 'library' || LIBRARY_CATEGORIES.includes(route as ModuleCategory) : machineView === 'library'
  const machineCounts: Record<string, number> = { octatrack: accessibleModules.length, ...Object.fromEntries(['digitakt', 'digitone'].map(id => [id, DIGI_MODS.filter(mod => mod.device === id).length])) }
  const workspace = useWorkspace()
  const { active: storedActive, ready, firmware, fileState, fileError, firmwareSaved, readFile, clearFile } = workspace
  // Each machine shows its own configurations; the Octatrack code below always works on an Octatrack configuration.
  const configurationsFor = (device: string) => workspace.configurations.filter(item => configurationDevice(item) === device)
  const activeFor = (device: string) => storedActive && configurationDevice(storedActive) === device ? storedActive : configurationsFor(device).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const active = activeFor('octatrack')
  const machineActive = activeFor(currentDevice.id)
  const machineConfigurations = configurationsFor(currentDevice.id)
  const sidebarConfiguration = allMachines ? storedActive : machineActive
  // Saved configurations live in a searchable browser; the sidebar stays the same size.
  const machineSelected = machineActive?.moduleIds ?? []
  // Keep Configuration available in All machines and on machines without mods.
  const configurationTarget = machineHasMods ? currentDevice.id : storedActive ? configurationDevice(storedActive) : 'octatrack'
  const configurationHref = deviceHref(configurationTarget, 'configuration')
  const configurationCount = activeFor(configurationTarget)?.moduleIds.length ?? 0
  function ensureActive(item?: Configuration) { if (item && storedActive?.id !== item.id) workspace.selectConfiguration(item.id) }
  function setKeepStockFx2(value: boolean) { ensureActive(active); workspace.setKeepStockFx2(value) }
  function toggleMachineModule(id: string) { workspace.toggleModule(id, currentDevice.id) }
  const selectedIds = active?.moduleIds ?? []
  const firmwareBuild = useFirmwareBuild(workspace.firmwareClient, active, firmware)
  const builtSha = firmwareBuild.state === 'built' ? firmwareBuild.result?.sha256 ?? '' : ''
  useEffect(() => {
    // Issue reports name the active configuration or another one saved here and, once built here, the image hash (never the image).
    const configurationsFor = (device: string) => workspace.configurations.filter(item => configurationDevice(item) === device)
    const activeFor = (device: string) => storedActive && configurationDevice(storedActive) === device ? storedActive : configurationsFor(device).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    const modulesOf = (item?: Configuration) => (item?.moduleIds ?? []).map(id => ({ id, version: item?.moduleVersions[id] ?? '' })).filter(value => value.version)
    const keepStockFx2 = (item?: Configuration) => DSP_LOADER ? item?.keepStockFx2 ?? true : null
    setWorkspaceReportContext({ configurationName: active?.name ?? '', modules: modulesOf(active), keepStockFx2: keepStockFx2(active), build: builtSha, activeId: active?.id ?? '', configurations: configurationsFor('octatrack').map(item => ({ id: item.id, name: item.name, modules: modulesOf(item), keepStockFx2: keepStockFx2(item) })) })
    for (const device of ['digitakt','digitone']) {
      const item = activeFor(device)
      setWorkspaceReportContext({ configurationName: item?.name ?? '', modules: modulesOf(item), keepStockFx2: null, build: '', activeId: item?.id ?? '', configurations: configurationsFor(device).map(value => ({ id: value.id, name: value.name, modules: modulesOf(value), keepStockFx2: null })) }, device)
    }
  }, [active, builtSha, storedActive, workspace.configurations])
  const [browse, setBrowse] = useState<CatalogBrowse | null>(() => readCatalogBrowse(true))
  const initialBrowse = detailModule || digiMod || route === browse?.route ? browse : null
  const [query, setQuery] = useState(initialBrowse?.query ?? '')
  function rememberBrowse(value: CatalogBrowse) { setBrowse(value); saveCatalogBrowse(value) }
  function restoreBrowse() { if (browse) { setQuery(browse.query); setFamily(browse.family); setSort(browse.sort) } }
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchToggleRef = useRef<HTMLButtonElement>(null)
  const searchExpanded = searchOpen || query !== ''
  // Phones show search as an icon; open it within the tap so the keyboard appears.
  function openSearch() { flushSync(() => setSearchOpen(true)); searchRef.current?.focus() }
  function closeSearch() { setQuery(''); flushSync(() => setSearchOpen(false)); searchToggleRef.current?.focus() }
  const [family,setFamily]=useState(initialBrowse?.family ?? 'all'),[sort,setSort]=useState(initialBrowse?.sort ?? DEFAULT_MODULE_SORT),[comparison,setComparison]=useState<string[]>([]),[compareOpen,setCompareOpen]=useState(false)
  const [statistics,setStatistics]=useState<ModuleStatistics[]|null>(null)
  useEffect(()=>{let cancelled=false,latest=0;function load(){if(!session.available)return;const request=++latest;void api<ModuleStatistics[]>('/community/summary').then(value=>{if(!cancelled&&request===latest)setStatistics(value)}).catch(()=>{if(!cancelled&&request===latest)setStatistics(null)})}load();window.addEventListener(MODULE_STATISTICS_CHANGED,load);return()=>{cancelled=true;window.removeEventListener(MODULE_STATISTICS_CHANGED,load)}},[session.available,onLibrary])
  const [dragging, setDragging] = useState(false)
  const [saved, setSaved] = useState(false)
  const [riskAccepted, setRiskAccepted] = useState<{key:string;accepted:boolean}>({key:'',accepted:false})
  const [importError,setImportError]=useState('')
  const importRef=useRef<HTMLInputElement>(null)
  const [configDialog, setConfigDialog] = useState<'create' | 'rename' | 'duplicate' | 'delete' | null>(null)
  const [reportingConfiguration, setReportingConfiguration] = useState<{ machine: string; id: string } | null>(null)
  const [createDevice, setCreateDevice] = useState<string | null>(null)
  // Phones render the library's results bar into this slot under the sticky category chips.
  const [resultsSlot, setResultsSlot] = useState<HTMLDivElement | null>(null)
  // The configuration page shows what follows a build in its main column, away from the sticky build card.
  const [buildResultsSlot, setBuildResultsSlot] = useState<HTMLDivElement | null>(null)
  function newConfiguration(device = currentDevice.id) { setCreateDevice(device); setConfigDialog('create') }
  const [supportOpen, setSupportOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const toolbarRef = useRef<HTMLElement>(null)
  const toolbarHidden = usePhoneToolbar(phoneLayout, toolbarRef, route)
  const libraryNavRef = useRef<HTMLElement>(null)
  // On phones the library nav is a horizontal strip; keep the current section in view.
  useEffect(() => {
    const active = libraryNavRef.current?.querySelector('.active')
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    else libraryNavRef.current?.scrollTo({ left: 0 })
  }, [route])
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); window.scrollTo({ top: 0 }) }, [route])
  useEffect(() => {
    const appUrl = new URL(document.baseURI)
    if (detailModule) setPageMetadata({ title: detailModule.name + ' for Elektron Octatrack — Modwerk', description: detailModule.description, url: new URL(moduleHref(detailModule.id), appUrl).href })
    else if (digiMod) setPageMetadata({ title: digiMod.title + ' for Elektron ' + currentDevice.name + ' — Modwerk', description: digiMod.summary, url: new URL(deviceHref(digiMod.device, 'module/' + digiMod.id), appUrl).href })
    else if (projectsRoute) setPageMetadata({ title: PROJECT_TITLE + ' — Modwerk', description: PROJECT_DESCRIPTION, url: new URL('projects/', appUrl).href, image: PROJECT_PREVIEW_IMAGE, imageAlt: PROJECT_PREVIEW_ALT })
    else if (route === 'submit') setPageMetadata({ title: 'Start developing — Modwerk', description: 'Build a mod for Elektron instruments: write it with the SDK, submit it through GitHub and get it reviewed for the Modwerk library.', url: new URL('submit/', appUrl).href })
    // A public thread owns its title and description, supplied by its static page and refreshed after loading.
    else if (!route.startsWith('forum/thread/')) {
      const title = allRoute || route === 'library' ? HOME_TITLE : (machineView==='configuration'?currentDevice.name+' module set':machineView?currentDevice.name+' modules':forumRoute?'Forum':accountRoute?'Account':developerRoute?(developer?.user&&!route.startsWith('developer/complete')?'Creator settings':'Account'):route==='your-octatrack'?'Your Octatrack':route==='faq'?'FAQ':route==='credits'?'Credits':route==='privacy'?'Privacy':route==='impressum'?'Impressum':route==='community-rules'?'Community rules':route==='report-content'?'Report content':route==='configuration'?'Module set':route.startsWith('submit')?'Start developing':(route==='review'||route==='admin')?'Admin workspace':route.startsWith('module-set')?'Module sets':'Module library')+' · Modwerk'
      setPageMetadata({ title, description: HOME_DESCRIPTION, url: appUrl.href })
    }
  }, [projectsRoute, route,detailModule,digiMod,forumRoute,accountRoute,developerRoute,developer?.user,allRoute,machineView,currentDevice.name])
  const selection = resolveSelection(selectedIds)
  const availabilityError = moduleAvailabilityError(selectedIds, betaAccess)
  const stockFx2Kept = DSP_LOADER && (active?.keepStockFx2 ?? true)
  const conflicts = selectionConflicts(selectedIds, stockFx2Kept)
  // What each module in the library would do to this configuration, so a conflicting add is flagged before it happens.
  const addBlockMap = addBlocks(selectedIds, stockFx2Kept, accessibleModules.map(module => module.id))
  const libraryFilter = allRoute ? allCategory ?? 'all' : filter
  const libraryFamily = allRoute || accessibleModules.some(module=>DETAILS[module.id].family===family) ? family : 'all'
  const visibleModules = accessibleModules.filter((module) =>
    (libraryFilter === 'all' || module.category === libraryFilter)
    && (libraryFamily==='all'||DETAILS[module.id].family===libraryFamily)
    && (module.name + ' ' + module.description + ' ' + module.authorName + ' ' + module.author + ' ' + contributorSearchText(module.contributors)).toLowerCase().includes(query.toLowerCase().trim()),
  ).sort((a,b)=>compareModules(a,b,sort,statistics))
  const displayedModules = detailModule ? [detailModule] : allRoute || route === 'library' || LIBRARY_CATEGORIES.includes(route as typeof LIBRARY_CATEGORIES[number]) ? visibleModules : []
  const { viewed: viewedModuleVersions, baseline: moduleBaseline } = useModuleUpdates(displayedModules, MODULES, detailModule?.id)

  function toggleComparison(id: string) { setComparison(current=>current.includes(id)?current.filter(value=>value!==id):current.length<3?[...current,id]:current) }
  function toggleModule(id: string) {
    if (id === USB_AUDIO_MODULE && !selectedIds.includes(id)) {
      setCompareOpen(false)
      window.history.pushState(null, '', new URL(moduleHref(id) + '?setup=1', document.baseURI))
      window.dispatchEvent(new Event('hashchange'))
      return
    }
    workspace.toggleModule(id); setSaved(false); setRiskAccepted({key:'',accepted:false})
  }
  // Replaces the modules a new one cannot run beside. Adding last goes through toggleModule, which also opens USB setup.
  function swapModule(id: string, removeIds: readonly string[]) {
    for (const removed of removeIds) if (selectedIds.includes(removed)) workspace.toggleModule(removed)
    toggleModule(id)
  }
  function configureUsbAudio(value: UsbAudioConfiguration | undefined) {
    workspace.configureUsbAudio(value); setSaved(false); setRiskAccepted({key:'',accepted:false})
  }
  function fixConflict(fix: ConflictFix) {
    for (const id of fix.removeIds ?? []) if (selectedIds.includes(id)) workspace.toggleModule(id)
    if (fix.keepStockFx2 !== undefined) setKeepStockFx2(fix.keepStockFx2)
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
  function saveSelection() { downloadSelection(selectedIds, firmware, active?.name, DSP_LOADER && (active?.keepStockFx2 ?? true), active?.moduleVersions, active?.usbAudio, active?.removedStockFx); setSaved(true); trackUsage('configuration_exported') }
  async function importSelection(event: ChangeEvent<HTMLInputElement>) {
    const file=event.currentTarget.files?.[0]; event.currentTarget.value=''; if(!file)return
    setImportError('')
    try {
      if(file.size>32*1024)throw new Error('Module set backups must be smaller than 32 KB.')
      const imported=parseSelection(await file.text())
      workspace.importConfiguration(imported.name,imported.moduleIds,imported.keepStockFx2,imported.moduleVersions,'octatrack',imported.usbAudio,imported.removedStockFx)
      setSaved(false);setRiskAccepted({key:'',accepted:false});window.location.assign('#configuration')
    }catch(error){setImportError(error instanceof Error?error.message:'Could not import this module set.')}
  }
  function changeConfiguration(id: string) { const item = workspace.configurations.find(value => value.id === id); workspace.selectConfiguration(id); setSaved(false); setRiskAccepted({key:'',accepted:false}); window.location.assign(deviceHref(item ? configurationDevice(item) : currentDevice.id, 'configuration')) }
  function submitConfigurationDialog(name: string) {
    const targetDevice = configDialog === 'create' ? createDevice ?? currentDevice.id : currentDevice.id
    ensureActive(activeFor(targetDevice))
    if (configDialog === 'delete') workspace.deleteConfiguration()
    else if (configDialog === 'rename') workspace.renameConfiguration(name)
    else workspace.createConfiguration(name, configDialog === 'duplicate', targetDevice)
    setSaved(false); setRiskAccepted({key:'',accepted:false}); window.location.assign(deviceHref(targetDevice, 'configuration'))
  }

  // Routes that browse a library: they get the search field and, on phones, the category chips under the app bar.
  const libraryNav = onLibrary || route === 'module-sets'
  const firmwareVerified = !allMachines && currentDevice.id === 'octatrack' && !!firmware
  const machineStatus = allMachines ? 'All machines' : currentDevice.id !== 'octatrack' ? currentDevice.name + (machineHasMods ? DIGI_DOWNLOADS_ENABLED ? ' · local builds' : ' · builds in preview' : ' · no mods yet') : firmware ? 'OS 1.40C verified' : 'No base firmware selected'
  const saveStatus = workspace.saving ? "Saving…" : workspace.storageError ? "Changes not saved" : "Workspace saved on device"
  const legalLinks = <nav className="legal-links" aria-label="Project and legal information"><a href="#credits" aria-current={route === 'credits' ? 'page' : undefined}>Credits</a><a href="#privacy">Privacy</a><a href="#impressum">Impressum</a><a href="#report-content">Report content</a></nav>
  // Phones show the independence notice in the page footer; wider layouts keep it above the content.
  const machinePicker = <MachineSwitcher current={currentDevice} all={allMachines} counts={machineCounts} compact={phoneLayout} />
  // Phones keep Compare and Build firmware out of the library header; a dock offers them once there is something to act on.
  const phoneLibrary = phoneLayout && onLibrary
  const comparedNames = comparison.map(id => MODULES.find(module => module.id === id)?.name ?? DIGI_MODS.find(mod => mod.device + '-' + mod.id === id)?.title ?? id)
  const dockBuild = phoneLibrary && configurationCount > 0 && (allMachines || machineHasMods) ? { count: configurationCount, detail: (activeFor(configurationTarget)?.name ?? 'Configuration') + (allMachines ? ' · ' + DEVICES_BY_ID[configurationTarget].name : ''), href: configurationHref } : null
  const libraryDock = phoneLibrary && (comparison.length > 0 || !!dockBuild)
  const projectNotice = <aside className="project-notice" aria-label="Project independence"><p>{INDEPENDENCE_NOTICE}</p><a href={assetUrl('licenses/THIRD_PARTY_NOTICES.html')} target="_blank" rel="noreferrer">Copyright &amp; licence notices</a></aside>

  return (
    <OctatrackLinkContext.Provider value={usbLink ?? null}>
    <div className={'app-shell' + (phoneLayout ? (libraryNav ? ' has-library-nav' : '') + (toolbarHidden ? ' is-toolbar-hidden' : '') + (libraryDock ? ' has-library-dock' : '') : '')}>
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); mainRef.current?.focus() }}>Skip to content</a>
      <aside className="sidebar" aria-label="App sidebar">
        <div className="sidebar-brand">
          <a className="app-brand" href={'#' + ALL_MACHINES}><img src={import.meta.env.BASE_URL + 'modwerk-mark.svg'} width="34" height="34" alt="" /><span>Modwerk</span><small>Custom Elektron firmware</small></a>
        </div>
        <div className="sidebar-section-label">Library</div>
        <div className="library-nav-row">{phoneLibrary && machinePicker}<nav className="sidebar-nav" aria-label="Module library" ref={libraryNavRef}>
          <a href={libraryHref()} className={onLibrary && !libraryCategory ? 'active' : ''} aria-current={onLibrary && !libraryCategory ? 'page' : undefined}><Icon name="grid" /><span>All modules</span><small>{libraryCount()}</small></a>
          {SIDEBAR_CATEGORIES.map(category => {
            const count = libraryCount(category), current = onLibrary && libraryCategory === category
            return <a key={category} href={libraryHref(category)} onClick={()=>setFamily('all')} className={(current ? 'active' : '') + (count ? '' : ' is-empty') + (category === 'standalone' ? ' sidebar-standalone' : '')} aria-current={current ? 'page' : undefined}><Icon name={category==='standalone'?'lock':category==='scenes'?'grid':category==='effects'||category==='midi-usb'?'wave':'sliders'} /><span>{LIBRARY_CATEGORY_LABELS[category]}</span><small>{count}</small></a>
          })}
        </nav></div>
        {phoneLibrary && <div className="library-results-slot" ref={setResultsSlot} />}
        <div className="sidebar-section-label configuration-label"><span>Module sets</span><button className="icon-button" aria-label={'New ' + (machineHasMods ? currentDevice.name : 'Octatrack') + ' module set'} disabled={!ready} onClick={() => newConfiguration(machineHasMods ? currentDevice.id : 'octatrack')}><Icon name="plus" size={18} /></button></div>
        <div className="configuration-launcher"><a className="configuration-browse" href="#module-sets" aria-current={route === 'module-sets' ? 'page' : undefined}><Icon name="file" size={17} /><span>All module sets</span><small>{workspace.configurations.length}</small></a><button type="button" className="configuration-recent" disabled={!sidebarConfiguration} onClick={() => { const item = allMachines ? storedActive : machineActive; if (item) changeConfiguration(item.id) }}>{sidebarConfiguration ? <><span>{sidebarConfiguration.name}</span><small>{DEVICES_BY_ID[configurationDevice(sidebarConfiguration)].name} · current</small></> : <><span>No module set yet</span><small>Saved on this device</small></>}</button></div>
        <div className="sidebar-section-label community-label">Community & help</div><nav className="sidebar-nav community-nav" aria-label="Community and help"><div className="sidebar-nav-row"><a href="#forum" className={forumRoute?'active':''}><Icon name="message"/><span>Forum</span>{!online && <span className="sidebar-feature-new">New</span>}</a>{presence?.online ? <MembersOnlineChip presence={presence}/> : null}</div><a href="#projects" className={projectsRoute ? 'active' : ''} aria-current={projectsRoute ? 'page' : undefined}><Icon name="external"/><span>Other projects</span><span className="sidebar-feature-new">New</span></a><a href="#submit" className={route.startsWith('submit') ? 'active' : ''}><Icon name="plus"/><span>Start developing</span></a><a href="#faq" className={route === 'faq' ? 'active' : ''} aria-current={route === 'faq' ? 'page' : undefined}><Icon name="help" /><span>FAQ<span className="help-guide-label"> & flashing guide</span></span></a><a href="#credits" className={route === 'credits' ? 'active' : ''} aria-current={route === 'credits' ? 'page' : undefined}><Icon name="heart" /><span>Credits &amp; acknowledgements</span></a></nav>
        <div className="sidebar-spacer" />
        <AccountMenu route={route} />
        {allMachines ? <div className="sidebar-build"><span className="status-dot" /><span className="sidebar-build-copy"><strong>Builds are per machine</strong><small>Choose a machine in the library to build its firmware.</small></span></div> : currentDevice.id === 'octatrack' ? <a className="sidebar-build" href="#configuration" aria-label={firmware ? 'Base firmware ready — View configuration' : undefined} aria-describedby={firmware ? 'sidebar-firmware-status' : undefined}>
          <span className={'status-dot ' + (firmware ? 'verified' : '')} />
          <span className="sidebar-build-copy"><strong>{firmware ? 'Base firmware ready' : 'Choose firmware'}</strong><small id="sidebar-firmware-status">{firmware ? 'OS 1.40C · ' + (firmwareSaved ? 'saved on device' : 'this session') : 'Start with your own OS 1.40C file.'}</small></span>
          <Icon name="arrow" size={14} />
        </a> : machineHasMods ? <a className="sidebar-build" href={deviceHref(currentDevice.id, 'configuration')}><span className="status-dot preview" /><span className="sidebar-build-copy"><strong>Build in your browser</strong><small>{DIGI_DOWNLOADS_ENABLED ? <>Check, build and download {currentDevice.name} firmware locally.</> : <>Check and build {currentDevice.name} firmware. Downloads after review.</>}</small></span><Icon name="arrow" size={14} /></a> : <a className="sidebar-build" href={issueRepository() + '/blob/main/docs/ADD_A_MACHINE.md'} target="_blank" rel="noreferrer"><span className="status-dot" /><span className="sidebar-build-copy"><strong>No mods yet</strong><small>Help start the first {currentDevice.name} mod.</small></span><Icon name="arrow" size={14} /></a>}
        {usbLink && <OctatrackStatus link={usbLink} variant="sidebar"/>}
        {SUPPORT_URL && <div className="sidebar-footer"><SupportButton onClick={() => setSupportOpen(true)} /></div>}
      </aside>
      {compareOpen&&<ModuleComparison ids={comparison} selected={selectedIds} onToggle={toggleModule} digiSelected={{digitakt:activeFor('digitakt')?.moduleIds??[],digitone:activeFor('digitone')?.moduleIds??[]}} onToggleDigi={(device,id)=>workspace.toggleModule(id,device)} onClose={()=>setCompareOpen(false)}/>}
      {reportingConfiguration && <ConfigurationReportDialog machine={reportingConfiguration.machine} configurationId={reportingConfiguration.id} onClose={() => setReportingConfiguration(null)} />}
      {configDialog && <ConfigurationDialog mode={configDialog} initialName={configDialog === 'create' ? '' : configDialog === 'duplicate' ? (machineActive?.name ?? '') + ' copy' : machineActive?.name ?? ''} onSubmit={submitConfigurationDialog} onClose={() => { setConfigDialog(null); setCreateDevice(null) }} />}
      <PublicAnnouncement next={route} enabled={!accountRoute && !developerRoute && !configuration && machineView !== 'configuration' && !route.startsWith('submit') && !['admin', 'review', 'privacy', 'impressum', 'community-rules', 'report-content'].includes(route)} />
      {usbLink && !configuration && <OctatrackActivity link={usbLink}/>}
      {usbLink && (baseInstall || baseInstallPrompt.open) && <BaseInstallDialog link={usbLink} launch={baseInstall !== 'manual'} firmwareReady={!!firmware} onChooseFirmware={file => void readFile(file)} onClose={done => { if (baseInstall) setBaseInstall(null); else if (done) baseInstallPrompt.close(); else baseInstallPrompt.later() }}/>}
      {supportOpen && <SupportDialog url={SUPPORT_URL} onClose={() => setSupportOpen(false)} />}
      <HardwareFeedbackCheckIn enabled={!accountRoute && !developerRoute && !['admin', 'review', 'privacy', 'impressum', 'community-rules', 'report-content', 'submit'].includes(route.split('/')[0]) && !firmwareFeedbackPreview}/>
      <div className="workspace">
        <header className="app-toolbar" ref={toolbarRef}>
          <a className="toolbar-brand" href={'#' + ALL_MACHINES}><img src={import.meta.env.BASE_URL + 'modwerk-mark.svg'} width="30" height="30" alt="" /><span>Modwerk</span></a>
          <div className="toolbar-title"><Icon name={projectsRoute ? 'external' : route === 'faq' ? 'help' : route === 'credits' ? 'heart' : configuration || machineView === 'configuration' ? 'file' : 'grid'} size={17} /><span>{projectsRoute ? PROJECT_TITLE : route === 'your-octatrack' ? 'Your Octatrack' : route === 'faq' ? 'FAQ & flashing guide' : route === 'credits' ? 'Credits & acknowledgements' : configuration || machineView === 'configuration' ? 'Module set' : route === 'privacy' ? 'Privacy' : route === 'impressum' ? 'Impressum' : route === 'community-rules' ? 'Community rules' : route === 'report-content' ? 'Report content' : communityRoute ? 'Community' : route.startsWith('module-set') ? 'Module sets' : detailModule || digiMod ? <a href={libraryHref()}>Modules</a> : 'Modules'}</span>{(detailModule?.name ?? digiMod?.title) && <><span className="breadcrumb-divider">/</span><strong>{detailModule?.name ?? digiMod?.title}</strong></>}<span className="preview-badge">Preview</span></div>
          {libraryNav && <><label className={'search' + (searchExpanded ? ' is-open' : '')}><Icon name="search" size={15} /><input ref={searchRef} type="search" aria-label={route==='module-sets'?'Search module sets':'Search modules'} placeholder={route==='module-sets'?'Search sets':'Search modules'} value={query} onChange={(event) => setQuery(event.target.value)} onBlur={() => { if (!query) setSearchOpen(false) }} onKeyDown={(event) => { if (phoneLayout && event.key === 'Escape') closeSearch() }} /></label><button ref={searchToggleRef} type="button" className="toolbar-icon search-toggle" aria-label={route==='module-sets'?'Search module sets':'Search modules'} onClick={openSearch}><Icon name="search" size={20} /></button><button type="button" className="search-cancel" onClick={closeSearch}>Cancel</button></>}
          <div className="toolbar-actions">
            <NotificationBell next={route} />
            <a className={'configuration-button' + (configurationCount ? '' : ' is-empty')} href={configurationHref} aria-label={"Open module set, " + configurationCount + " modules selected"} aria-current={configuration || machineView === 'configuration' ? 'page' : undefined}><Icon name="sliders" size={16} /><span>Module set</span><span className="toolbar-count">{configurationCount}</span></a>
            <MobileMenu onConfigurations={() => window.location.assign('#module-sets')} route={route} online={online} selectedCount={configurationCount} configurationHref={configurationHref} admin={session.admin} developer={!!developer?.user} onSupport={SUPPORT_URL ? () => setSupportOpen(true) : undefined} />
          </div>
        </header>
        <main className="workspace-content" id="main-content" ref={mainRef} tabIndex={-1}>
          {firmwareFeedbackPreview && <Suspense fallback={null}><FirmwareFeedbackPreview/></Suspense>}
          {!accountRoute && <SignupWelcome key={route} />}
          {!accountRoute && !developerRoute && !configuration && machineView !== 'configuration' && !['admin', 'privacy', 'impressum', 'community-rules', 'report-content'].includes(route) && <HardwareFeedbackReminder />}
          {!phoneLayout && projectNotice}
          {workspace.storageError && <div className="file-error" role="alert">{workspace.storageError} Export important configurations before closing this tab.</div>}
          {workspace.unreadable > 0 && <p className="service-note" role="status">{workspace.unreadable === 1 ? 'One saved module set uses' : workspace.unreadable + ' saved module sets use'} a module or setting this version of Modwerk cannot open. {workspace.unreadable === 1 ? 'It stays' : 'They stay'} on this device and will reappear once it can.</p>}
          {projectsRoute ? <ProjectsPage key={`projects-page:${route}`} route={route} /> : yourOctatrackRoute && ready ? <YourOctatrack link={usbLink} sets={workspace.configurations.filter(item => configurationDevice(item) === 'octatrack')} prepareUpdate={usbKit?.prepareUpdate} readInventory={usbKit?.readInventory} stressTest={usbKit?.stressTest} onInstall={() => setBaseInstall('manual')} onSaveSet={target => { workspace.importConfiguration(target.name, target.moduleIds, true, undefined, 'octatrack', undefined, target.removedStockFx); window.location.assign('#configuration') }} /> : route === 'faq' ? <FaqPage /> : route === 'credits' ? <CreditsPage /> : !ready ? <div className="loading-panel" role="status">Opening your workspace…</div> : <>
          {onLibrary ? <MachineLibrary onBrowse={rememberBrowse} device={allMachines ? undefined : currentDevice} machinePicker={phoneLayout ? undefined : machinePicker} phone={phoneLayout} resultsSlot={resultsSlot} query={query} category={libraryCategory as ModuleCategory | undefined} octatrackModules={visibleModules} family={family} onFamilyChange={setFamily} sort={sort} onSortChange={setSort} statistics={statistics} octatrackConflicts={conflicts} octatrackBlocks={addBlockMap} onSwapOctatrack={swapModule} comparison={comparison} onCompare={toggleComparison} onOpenComparison={() => setCompareOpen(true)} viewedModuleVersions={viewedModuleVersions} moduleBaseline={moduleBaseline} octatrackSelected={selectedIds} onToggleOctatrack={toggleModule} digiSelected={{digitakt: activeFor('digitakt')?.moduleIds ?? [], digitone: activeFor('digitone')?.moduleIds ?? []}} onToggleDigi={(device, id) => workspace.toggleModule(id, device)} onClearSearch={() => { setQuery(''); setFamily('all') }}>
            {!allMachines && currentDevice.id === 'octatrack' && !!catalog.filter((item,index,items)=>!MODULES.some(module=>module.id===item.module_id)&&items.findIndex(other=>other.module_id===item.module_id)===index).length && <section className="published-collection"><h2>Community modules</h2><div className="module-grid">{catalog.filter((item,index,items)=>!MODULES.some(module=>module.id===item.module_id)&&items.findIndex(other=>other.module_id===item.module_id)===index).sort((a,b)=>compareModules({id:a.module_id,name:a.title,authorName:a.author,addedAt:a.added_at??undefined,updatedAt:a.updated_at??undefined},{id:b.module_id,name:b.title,authorName:b.author,addedAt:b.added_at??undefined,updatedAt:b.updated_at??undefined},sort,statistics)).map(item=><article className="published-card" key={item.module_id}><span className="pill">Reviewed contribution</span><h2><a href={'#community-module/'+item.module_id}>{item.title}</a></h2><p>{item.description}</p><ModulePopularity statistics={statistics?.find(stats=>stats.module_id===item.module_id)}/><a className="text-button" href={'#community-module/'+item.module_id}>View module →</a></article>)}</div></section>}
          </MachineLibrary> : digiDevice && digiMod ? <DigiModDetail browse={browse} onBackToResults={restoreBrowse} key={digiMod.device+'-'+digiMod.id} device={digiDevice} mod={digiMod} selected={machineSelected.includes(digiMod.id)} onToggle={() => toggleMachineModule(digiMod.id)} /> : digiDevice && machineView === 'configuration' ? <DigiConfiguration key={digiDevice.id} onReport={() => machineActive && setReportingConfiguration({ machine: digiDevice.id, id: machineActive.id })} device={digiDevice} configuration={machineActive} configurations={machineConfigurations} onSelect={id => { workspace.selectConfiguration(id) }} onDialog={setConfigDialog} onToggle={toggleMachineModule} onImport={item => workspace.importConfiguration(item.name,item.moduleIds,false,item.moduleVersions,digiDevice.id)} /> : missingRoute?<div className="no-results"><h1>{pausedModule ? 'Module temporarily unavailable' : 'Page not found'}</h1><p>{pausedModule ? pausedModule.name + ' has been temporarily removed due to reported audio crackling.' : 'This module or page is not in the current catalog.'}</p><a className="button button-quiet" href="#library">Open module library</a></div>:route==='module-sets'||route.startsWith('module-set/')?<ModuleSets query={query} yours={{ configurations: workspace.configurations, activeId: sidebarConfiguration?.id, currentDevice: machineHasMods ? currentDevice.id : 'octatrack', onSelect: changeConfiguration, onCreate: newConfiguration }} id={moduleRoute.startsWith('module-set/')?moduleRoute.slice(11):undefined} onUse={(name,ids)=>{workspace.importConfiguration(name,ids);window.location.assign('#configuration')}}/>:forumRoute ? <ForumPage key={route} route={route} configuration={storedActive} configurations={workspace.configurations} onCopy={config=>{const device=config.device??'octatrack';workspace.importConfiguration(config.name,config.moduleIds,config.keepStockFx2,config.moduleVersions,device,config.usbAudio);window.location.assign(deviceHref(device,'configuration'))}}/> : developerRoute ? <DeveloperPage key={route.startsWith('developer/report/')?route:route.split('/')[0]} route={route}/> : accountRoute ? <AccountPage key={route.split('/').slice(0,2).join('/')} route={route}/> : route === 'privacy' ? <PrivacyPage /> : ['impressum','community-rules','report-content'].includes(route) ? <LegalPage route={route}/> : route.startsWith('submit') ? <SubmissionPage key={route} moduleId={route.split('/')[1] ?? ''} /> : route === 'review'||route === 'admin' ? <AdminPage /> : communityModule ? <PublishedModulePage key={communityModule.module_id} module={communityModule} /> : detailModule ? <ModuleDetail browse={browse} onBackToResults={restoreBrowse} key={detailModule.id} module={detailModule} selected={selectedIds.includes(detailModule.id)} addBlock={addBlockMap[detailModule.id]} onSwap={removeIds => swapModule(detailModule.id, removeIds)} usbAudio={active?.usbAudio} configurationName={active?.name} configurationId={active?.id} onConfigureUsbAudio={configureUsbAudio} onToggle={() => toggleModule(detailModule.id)} /> : configuration ? (
            <div className="configuration-page">
              <ConfigurationHeader kicker="YOUR WORKSPACE" meta="Octatrack · OS 1.40C · Changes save automatically on this device. Module sets use current module versions." configuration={active} configurations={workspace.configurations} onSelect={changeConfiguration} onDialog={setConfigDialog} onImport={()=>importRef.current?.click()} shareHref="#forum/new?category=configs" canReport={!!selectedIds.length} onReport={() => active && setReportingConfiguration({ machine: 'octatrack', id: active.id })}/>
              <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={event=>void importSelection(event)} aria-label="Import module set backup"/>{importError&&<p className="file-error" role="alert">{importError}</p>}
              <input ref={inputRef} type="file" accept=".bin" onChange={chooseFile} hidden aria-label="Choose base firmware" />
              <div className="configuration-layout">
                <div className="configuration-main">
                  <section className="configuration-section" aria-labelledby="selection-title"><div className="section-title"><h2 id="selection-title">Selected modules <span className="subtle">{selection.length}</span></h2><a className="text-button" href="#library">Browse modules <Icon name="plus" size={14} /></a></div>
                    {availabilityError && <p className="file-error" role="alert">{availabilityError}</p>}
                    {selection.length ? <ul className="selected-list">{selection.map((module) => <li key={module.id}><a className="selected-module-link" href={moduleHref(module.id)}><ModulePreview id={module.id} compact /><span><strong>{module.name}</strong><small>{module.id === USB_AUDIO_MODULE && active?.usbAudio ? usbAudioLayout(active.usbAudio.layout).name + ' · 0.2 experimental' : (!isModuleAvailable(module.id, betaAccess) ? 'Temporarily unavailable' : module.detail) + ' · ' + module.authorName}</small></span></a><button className="icon-button" aria-label={'Remove ' + module.name} onClick={() => toggleModule(module.id)}><Icon name="close" size={17} /></button></li>)}</ul> : <div className="selection-empty"><Icon name="grid" size={26} /><strong>No modules selected</strong><p>Find something in the library and add it to your module set.</p><a className="button button-quiet" href="#library">Browse modules</a></div>}
                  </section>
                  {usbBase ? <StockEffects removed={active?.removedStockFx ?? []} onChange={workspace.setRemovedStockFx} /> : <ConfigurationEffects ids={selectedIds} keepStockFx2={active?.keepStockFx2 ?? true} build={firmwareBuild} />}
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
                  {DSP_LOADER && <section className="configuration-section chooser-options"><h2>Effect menus</h2><label><input type="checkbox" checked={active?.keepStockFx2??true} onChange={event=>setKeepStockFx2(event.target.checked)}/><span><strong>Keep stock FX2 effects</strong><small>Keep the original FX2 effects alongside your modules.</small></span></label></section>}
                  <div ref={setBuildResultsSlot} className="build-results" />
                </div>
                <div className="configuration-checkout">
                  <Suspense fallback={null}><CompatibilityPanel ids={selectedIds} keepStockFx2={DSP_LOADER && (active?.keepStockFx2??true)} buildState={firmwareBuild.state} buildError={firmwareBuild.error} buildConflict={firmwareBuild.conflict} onFix={fixConflict}/></Suspense>
                  <div className="checkout-card">
                    <RiskAcceptance checked={riskAccepted.key===firmwareBuild.key&&riskAccepted.accepted} onChange={accepted => setRiskAccepted({key:firmwareBuild.key,accepted})}/>
                    <MemberGate action="build firmware" next={route}>{usbKit ? <OctatrackUpdate link={usbKit.link} set={{ name: active?.name ?? 'Module set', moduleIds: selectedIds, removedStockFx: active?.removedStockFx }} prepareUpdate={usbKit.prepareUpdate} readInventory={usbKit.readInventory} stressTest={usbKit.stressTest} onInstall={() => setBaseInstall('manual')}><FirmwareBuildPanel build={firmwareBuild} available={ENGINE_AVAILABLE} downloadsEnabled={DOWNLOADS_ENABLED} firmwareReady={!!firmware} moduleCount={selection.length} riskAccepted={riskAccepted.key===firmwareBuild.key&&riskAccepted.accepted} configurationName={active?.name??'Configuration'} onExport={saveSelection} exported={saved} results={buildResultsSlot}/></OctatrackUpdate> : <FirmwareBuildPanel build={firmwareBuild} available={ENGINE_AVAILABLE} downloadsEnabled={DOWNLOADS_ENABLED} firmwareReady={!!firmware} moduleCount={selection.length} riskAccepted={riskAccepted.key===firmwareBuild.key&&riskAccepted.accepted} configurationName={active?.name??'Configuration'} onExport={saveSelection} exported={saved} results={buildResultsSlot}/>}</MemberGate>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          </>}
        </main>
        {libraryDock && <LibraryDock compared={comparedNames} onClearComparison={() => setComparison([])} onCompare={() => setCompareOpen(true)} build={dockBuild} />}
        {forumRoute&&!route.startsWith('forum/shoutbox')&&<ForumShoutbox floating/>}
        {phoneLayout ? <footer className="phone-footer">
          <p className="phone-footer-status"><span className={'status-dot ' + (firmwareVerified ? 'verified' : '')} /><span>{machineStatus}</span><span role="status">{saveStatus}</span></p>
          {legalLinks}
          {projectNotice}
        </footer> : <footer className={'status-bar'+(allMachines?' is-all-machines':'')}>{legalLinks}<span><span className={'status-dot ' + (firmwareVerified ? 'verified' : '')} />{machineStatus}</span><span className="status-build" role="status">{saveStatus}</span>{usbLink && <OctatrackStatus link={usbLink} variant="bar"/>}{machineHasMods ? <a href={deviceHref(currentDevice.id, 'configuration')} aria-live="polite">{machineSelected.length} {machineSelected.length === 1 ? 'module' : 'modules'} selected <Icon name="arrow" size={12} /></a> : <span />}</footer>}
      </div>
    </div>
    </OctatrackLinkContext.Provider>
  )
}
