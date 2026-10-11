import type { CatalogBrowse } from '../catalog/catalog-browse'
import { ModuleDetailLayout } from '../components/ModuleDetailLayout'
import { ModuleResourceSummary, type ResourceIndicator } from '../components/ModuleResourceSummary'
import { Icon } from '../components/Icon'
import { ModuleUsageInstructions } from '../components/ModuleUsageInstructions'
import { DigiIssueReport } from '../community/DigiIssueReport'
import { issueRepository } from '../community/report-context'
import { FLASHING_RISKS, FIRMWARE_SHARING_NOTICE } from '../firmware-notices'
import { DIGI_CORES, DIGI_MODS, digiModuleDocument, estimateCombination, type DigiMod } from './digi-mods'
import { DigiModPreview } from './DigiModPreview'
import { deviceHref, type DeviceProfile } from './registry'
import { ModuleAuthors } from '../components/ModuleAuthors'

const kib = (bytes: number) => (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + ' KiB'
const documentUrl = (mod: DigiMod, path: string) => issueRepository() + '/blob/main/sdk/' + mod.device + '/modules/' + mod.id + '/' + path

function DigiResourceIndicators({ mod }: { mod: DigiMod }) {
  const document = digiModuleDocument(mod)
  const core = DIGI_CORES[mod.device], memory = document.resources.memoryBytes
  const indicators: ResourceIndicator[] = [
    { id: 'cpu', label: 'CPU', value: '—', status: 'Not measured', score: null, fill: 0 },
    { id: 'dsp', label: 'DSP core', value: '—', status: 'Not measured', score: null, fill: 0 },
    { id: 'memory', label: 'Memory', value: memory === null ? '—' : kib(memory), status: memory === null ? 'Not measured' : 'Estimated',
      score: memory, maximum: core.areaBytes, fill: memory === null ? 0 : Math.min(100, memory / core.areaBytes * 100),
      valueText: memory === null ? undefined : kib(memory) + ' of ' + kib(core.areaBytes) + ' shared mod memory' },
  ]
  return <ModuleResourceSummary indicators={indicators} evidence={<>
    <h3>Resource estimates</h3>
    <p className="resource-evidence-date">v{document.version}</p>
    <p>CPU and DSP load have no separate measurements yet. {document.resources.load.display}. {document.resources.load.conditions}</p>
    <p>{memory === null ? 'Memory has not been measured.' : <>Memory shows this module’s code and data as a share of the {kib(core.areaBytes)} mod area. {kib(core.ramBytes)} is reserved separately for the core and alignment.</>} The build’s own checks decide whether a configuration fits.</p>
    <a href={documentUrl(mod, document.tests.report)} target="_blank" rel="noreferrer">Read record ↗</a>
  </>} />
}

function DigiModuleGuide({ mod, device }: { mod: DigiMod; device: DeviceProfile }) {
  const document = digiModuleDocument(mod), core = DIGI_CORES[mod.device]
  const others = DIGI_MODS.filter(other => other.device === mod.device && other.id !== mod.id)
  const access = document.access, controls = document.controls
  return <>
    <details className="module-disclosure">
      <summary><span>About & credits</span><Icon name="plus" size={16} /></summary>
      <div className="disclosure-content">
        <div className="overview-grid">
          <section className="detail-section"><h2>About this module</h2><p>{document.presentation.overview}</p><ul className="feature-list">{document.presentation.highlights.map(item => <li key={item}><Icon name="check" size={15} />{item}</li>)}</ul></section>
          <aside className="info-panel"><h2>Module information</h2><dl>
            <div><dt>{mod.contributors?.length ? 'Authors' : 'Author'}</dt><dd><ModuleAuthors name={mod.author} url={mod.repository} contributors={mod.contributors} arrows/></dd></div>
            <div><dt>Location</dt><dd>{'location' in access ? access.location : access.noUiReason}</dd></div>
            <div><dt>Base firmware</dt><dd>OS {mod.releases.join(' / ')}</dd></div>
            <div><dt>Module version</dt><dd>{document.version}</dd></div>
            <div><dt>Licence</dt><dd><a href={documentUrl(mod, document.license.file)} target="_blank" rel="noreferrer">{mod.license}</a></dd></div>
            <div><dt>Catalog</dt><dd>Experimental</dd></div>
          </dl><a className="source-link" href={mod.repository} target="_blank" rel="noreferrer">Module source <Icon name="arrow" size={14} /></a></aside>
        </div>
        <section className="detail-section"><h2>Credits</h2><ul>{document.author.credits.map(credit => <li key={credit}>{credit}</li>)}</ul></section>
      </div>
    </details>
    <details className="module-disclosure controls-section">
      <summary><span>Controls & defaults{controls.length > 0 && <small>{controls.length} controls</small>}</span><Icon name="plus" size={16} /></summary>
      <div className="disclosure-content">
        {controls.length ? <><p className="service-note">Starting values · adjust on your {device.name}.</p><dl className="control-docs">{controls.map(control => <div key={control.name}><dt>{control.name}<span>{control.default === null ? '—' : control.labels?.[control.default] ?? control.default}</span></dt><dd>{control.doc}{control.labels && control.labels.length <= 8 && <small>{control.labels.join(' · ')}</small>}</dd></div>)}</dl></> : <p>{'noUiReason' in access ? access.noUiReason : 'Use the controls described in “How to use it”. No additional defaults are declared for this module.'}</p>}
      </div>
    </details>
    <details className="module-disclosure">
      <summary><span>How to use it</span><Icon name="plus" size={16} /></summary>
      <div className="disclosure-content">
        <section className="detail-section module-access"><h2>Find it on your {device.name}</h2>{'location' in access ? <><p>{access.location}</p><ol>{access.steps.map(step => <li key={step}>{step}</li>)}</ol></> : <p>{access.noUiReason}</p>}</section>
        <ModuleUsageInstructions module={{ id: mod.device + '-' + mod.id, name: document.name, version: document.version }} title={document.tests.documentation?.tutorial.title} steps={document.presentation.usage}/>
        <a href={documentUrl(mod, 'README.md')} target="_blank" rel="noreferrer">Read the complete guide ↗</a>
      </div>
    </details>
    <details className="module-disclosure">
      <summary><span>Technical details & safety<small>Resources, tests, flashing</small></span><Icon name="plus" size={16} /></summary>
      <div className="disclosure-content">
        <section className="detail-section resource-section"><div className="section-title"><h2>Storage & processing</h2><span className="subtle">v{document.version}</span></div>
          <div className="resource-grid"><div className="resource-card"><span>Shared mod memory</span><strong>{document.resources.memoryBytes === null ? 'Not measured' : kib(mod.ramBytes)}</strong><p>{kib(core.areaBytes)} shared by all mods; {kib(core.ramBytes)} reserved for the core and alignment.</p></div><div className="resource-card"><span>Processing load</span><strong>{document.resources.load.display}</strong><p>{document.resources.load.conditions}</p></div></div>
          <p className="resource-note">Estimated from code and data sizes. The build’s own checks decide whether your complete module set fits. <a href={documentUrl(mod, document.tests.report)} target="_blank" rel="noreferrer">Read the measurement record ↗</a></p>
          <dl className="device-facts"><dt>Claims</dt><dd>{mod.claims.join(', ') || 'No shared resources claimed.'}</dd></dl>
          {!!document.compatibility.limitations.length && <><h3>Compatibility notes</h3><ul>{document.compatibility.limitations.map(note => <li key={note}>{note}</li>)}</ul></>}
        </section>
        {others.length > 0 && <section className="detail-section"><h2>Combines with</h2><ul className="feature-list">{others.map(other => {
          const estimate = estimateCombination(mod.device, [mod.id, other.id]), ok = estimate.fits && !estimate.clashes.length
          return <li key={other.id}><Icon name={ok ? 'check' : 'close'} size={15} /><a href={deviceHref(mod.device, 'module/' + other.id)}>{other.title}</a><span className="subtle">{ok ? 'fits together (' + kib(estimate.usedBytes) + ')' : estimate.fits ? 'cannot be used together' : 'too large together (' + kib(estimate.usedBytes) + ')'}</span></li>
        })}</ul><p className="combination-footnote">Estimated from code and data sizes. The build’s own check decides.</p></section>}
        <section className="quality-note"><h2>Test evidence & hardware status</h2><p>{document.tests.summary}</p><p>{mod.hardware ?? 'No hardware report yet.'}</p><a href={documentUrl(mod, document.tests.report)} target="_blank" rel="noreferrer">Source and test details ↗</a></section>
        <aside className="risk-note"><strong>Custom firmware · flash at your own risk</strong><p>{FLASHING_RISKS} Back up your projects and samples, read the module’s compatibility notes, and keep the original firmware. Passing tests does not guarantee safe operation on every device or configuration.</p><p>{FIRMWARE_SHARING_NOTICE}</p></aside>
      </div>
    </details>
  </>
}

export function DigiModDetail({ device, mod, selected, onToggle, browse, onBackToResults }: { browse?: CatalogBrowse | null; onBackToResults?: () => void; device: DeviceProfile & { id: DigiMod['device'] }; mod: DigiMod; selected: boolean; onToggle: () => void }) {
  const document = digiModuleDocument(mod), id = mod.device + '-' + mod.id
  return <ModuleDetailLayout browse={browse} onBackToResults={onBackToResults} id={id} title={mod.title} family={mod.category}
    detail={'location' in document.access ? document.access.location : document.access.noUiReason}
    author={mod.author} authorUrl={mod.repository} contributors={mod.contributors} description={mod.summary} selected={selected} onToggle={onToggle}
    backHref={deviceHref(mod.device)} backLabel={'All ' + device.name + ' modules'}
    preview={<DigiModPreview mod={mod} />} resources={<DigiResourceIndicators mod={mod} />}
    guide={<DigiModuleGuide mod={mod} device={device} />}
    issueReport={openRequest => <DigiIssueReport id={id} openRequest={openRequest} />}
  />
}
