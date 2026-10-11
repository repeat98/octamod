import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ModuleCommunity } from '../community/ModuleCommunity'
import { CreatorSupport } from '../community/CreatorSupport'
import { ModuleChangelog } from '../community/ModuleChangelog'
import { IssueCount, ModuleIssues } from '../community/ModuleIssues'
import { useModuleIssues } from '../community/issue-tracker'
import { ModuleUpdateButton } from '../community/ModuleUpdateButton'
import { ModuleWorksReportButton } from '../community/ModuleWorksReportButton'
import { ModuleFeedbackPanel } from '../community/ModuleFeedbackPanel'
import { useModuleWorksReports } from '../community/use-module-works-reports'
import { ShareModuleButton } from '../community/ShareModuleButton'
import { Icon } from './Icon'
import { useCommunity } from '../community/context'
import { hasBetaAccess } from '../community/beta-access'
import { catalogNeighbors, type CatalogBrowse } from '../catalog/catalog-browse'
import { CatalogNavigation } from './CatalogNavigation'
import { ModuleAuthors } from './ModuleAuthors'
import type { ModuleContributor } from '../catalog/module-authors'
import type { AddBlock } from '../catalog/add-blocks'
import { AddBlockChip, AddBlockPrompt } from './AddBlockPrompt'
import { useAddBlockPrompt } from './use-add-block-prompt'

type DetailTab = 'Overview' | 'Media' | 'Discussion' | 'Changelog' | 'Issues'
const tabs: DetailTab[] = ['Overview', 'Media', 'Discussion', 'Changelog', 'Issues']
function linkedTab(): DetailTab {
  if (typeof window === 'undefined') return 'Overview'
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? window.location.search)
  if (query.get('report') === '1') return 'Issues'
  return tabs.find(value => value.toLowerCase() === query.get('tab')) ?? 'Overview'
}

export function ModuleDetailLayout({ id, title, family, detail, author, authorUrl, contributors, description, selected, onToggle, backHref, backLabel, preview, resources, notice, guide, issueReport, browse, onBackToResults, titleBadge, configureTarget, overviewIntro, addBlock, onSwap }: {
  browse?: CatalogBrowse | null; onBackToResults?: () => void
  id: string; title: string; family: string; detail: string; author: string; authorUrl: string; description: string
  contributors?: readonly ModuleContributor[]
  titleBadge?: string
  configureTarget?: string
  selected: boolean; onToggle: () => void; backHref: string; backLabel: string
  preview: ReactNode; resources: ReactNode; notice?: ReactNode; guide: ReactNode
  issueReport: (openRequest: number) => ReactNode
  overviewIntro?: ReactNode
  // What adding this module would do to the current configuration; undefined when it fits.
  addBlock?: AddBlock; onSwap?: (removeIds: readonly string[]) => void
}) {
  const navigation = catalogNeighbors(browse, id, hasBetaAccess(useCommunity().session))
  const [tab, setTab] = useState<DetailTab>(linkedTab)
  const pending = selected ? undefined : addBlock
  const addTrigger = useRef<HTMLButtonElement>(null)
  const prompt = useAddBlockPrompt(pending, addTrigger)
  const [issueOpenRequest, setIssueOpenRequest] = useState(0)
  const issues = useModuleIssues(id)
  const workingCount = useModuleWorksReports(id)
  const [discussionCount, setDiscussionCount] = useState<number | null>(null)
  useEffect(() => { const navigate = () => setTab(linkedTab()); window.addEventListener('hashchange', navigate); return () => window.removeEventListener('hashchange', navigate) }, [])
  function showConfiguration() {
    setTab('Overview')
    requestAnimationFrame(() => {
      document.getElementById(configureTarget!)?.scrollIntoView({ block: 'start' })
      document.getElementById(configureTarget!)?.focus({ preventScroll: true })
    })
  }
  function showDiscussion() {
    setTab('Discussion')
    document.getElementById('tab-Discussion')?.focus()
  }
  function showIssueReport() { setTab('Issues'); setIssueOpenRequest(request => request + 1) }
  const discussionBadge = <span className="module-tab-count-slot"><span className="tab-count">{discussionCount ?? '—'}<span className="sr-only">{discussionCount === null ? ' comments loading' : discussionCount === 1 ? ' comment' : ' comments'}</span></span></span>
  return <div className={'detail-page' + (navigation && navigation.total > 1 ? ' has-catalog-navigation' : '')}>
    {navigation && navigation.total > 1 && <CatalogNavigation navigation={navigation} />}
    <div className="module-page-actions">
      <div className="module-browse-context"><a className="back-link" href={navigation?.backHref ?? backHref} onClick={navigation ? onBackToResults : undefined}><Icon name="back" size={15} />{navigation ? 'Back to results' : backLabel}</a>{navigation && <span className="catalog-position" aria-label={'Module ' + navigation.position + ' of ' + navigation.total + ' results'}>{navigation.position} of {navigation.total}</span>}</div>
      <div className="module-page-buttons"><ShareModuleButton id={id} title={title} /></div>
    </div>
    <section className="detail-hero detail-hero-with-resources" aria-labelledby="module-title">
      {preview}
      <div className="detail-intro">
        <div className="detail-tags"><span className="pill">{family}</span><span className="subtle">{detail}</span></div>
        <div className="detail-title"><h1 id="module-title">{title}</h1>{titleBadge && <span className="module-compatibility-badge">{titleBadge}</span>}</div>
        <div className="module-creator"><ModuleAuthors name={author} url={authorUrl} contributors={contributors} by arrows><CreatorSupport key={id} id={id}/></ModuleAuthors></div>
        <p className="detail-description">{description}</p>
        {notice && <div className="detail-notice">{notice}</div>}
        <div className="module-add-region">
          {prompt.conflict
            ? <button ref={addTrigger} className="button button-quiet module-configure-action is-conflict" onClick={prompt.toggle} aria-expanded={prompt.open} aria-controls={prompt.id}><Icon name="swap" size={16} /><span className="add-block-label">{prompt.conflict.reason}</span></button>
            : <button className={'button module-configure-action ' + (selected ? 'button-added' : 'button-primary')} onClick={configureTarget && !selected ? showConfiguration : onToggle} aria-pressed={selected}><Icon name={selected ? 'check' : configureTarget ? 'sliders' : 'plus'} size={16} />{selected ? 'Added to module set' : configureTarget ? 'Configure ' + title : 'Add to module set'}</button>}
          {pending && !prompt.conflict && <AddBlockChip block={pending} />}
          {prompt.conflict && prompt.open && <AddBlockPrompt id={prompt.id} name={title} block={prompt.conflict} onCancel={prompt.close}
            onSwap={() => { onSwap?.(prompt.conflict?.swapRemoveIds ?? []); prompt.close() }} onAddAnyway={() => { onToggle(); prompt.close() }} />}
        </div>
        <ModuleUpdateButton id={id} compact />
        <ModuleFeedbackPanel workingCount={workingCount} workingAction={<ModuleWorksReportButton key={id} id={id}/>} onReportIssue={showIssueReport}/>
        <div className="detail-rating"><button className="text-button" onClick={showDiscussion}>Reviews & discussion{discussionBadge}</button></div>
      </div>
      {resources}
    </section>
    <div className="detail-tabs" role="tablist" aria-label="Module information">
      {tabs.map(value => <button key={value} role="tab" id={'tab-' + value} aria-selected={tab === value} aria-controls="detail-content" tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
        let next: DetailTab | undefined
        if (event.key === 'ArrowRight') next = tabs[(tabs.indexOf(value) + 1) % tabs.length]
        if (event.key === 'ArrowLeft') next = tabs[(tabs.indexOf(value) + tabs.length - 1) % tabs.length]
        if (event.key === 'Home') next = tabs[0]
        if (event.key === 'End') next = tabs[tabs.length - 1]
        if (next) { event.preventDefault(); setTab(next); document.getElementById('tab-' + next)?.focus() }
      }}>{value}{value === 'Issues' && <span className="module-tab-count-slot">{issues.data ? <IssueCount count={issues.data.openCount}/> : <span className="tab-count" aria-label={issues.error ? 'Issue count unavailable' : 'Loading issue count'}>—</span>}</span>}{value === 'Discussion' && discussionBadge}</button>)}
    </div>
    <div id="detail-content" role="tabpanel" aria-labelledby={'tab-' + tab} tabIndex={0}>
      {tab === 'Overview' && <>
        {overviewIntro}
        <ModuleCommunity id={id} mode="overview" onDiscuss={showDiscussion} onDiscussionCount={setDiscussionCount} />
        <div className="module-guide">{guide}</div>
      </>}
      {tab === 'Media' && <ModuleCommunity id={id} mode="media" onDiscussionCount={setDiscussionCount} />}
      {tab === 'Discussion' && <ModuleCommunity id={id} mode="discussion" onReportIssue={showIssueReport} onDiscussionCount={setDiscussionCount} />}
      {tab === 'Changelog' && <ModuleChangelog key={id} id={id} />}
      {tab === 'Issues' && <ModuleIssues key={id} id={id} issues={issues} onReportIssue={showIssueReport} />}
      {/* Stays mounted on the other tabs so a report in progress is not lost. */}
      <div hidden={tab !== 'Issues'}>{issueReport(issueOpenRequest)}</div>
    </div>
  </div>
}
