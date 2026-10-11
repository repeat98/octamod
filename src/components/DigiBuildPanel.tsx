// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { DownloadedBuildOverview } from '../community/HardwareFeedbackCheckIn'
import { builtModules } from '../community/build-follow-up'
import { useDownloadFollows } from '../community/useDownloadFollows'
import { trackFirmwareDownload } from '../community/usage'
import { DIGI_MODS, type DigiMod } from '../devices/digi-mods'
import { BUILDER_SOURCE, buildLogText, planBuild } from '../engine/elekloader/machine-build'
import { DIGI_DOWNLOADS_ENABLED } from '../engine/elekloader/protocol'
import { FIRMWARE_SHARING_NOTICE, FLASHING_RISKS } from '../firmware-notices'
import { RiskAcceptance } from './ConfigurationLayout'
import { assetUrl } from '../hosting'
import { useDigiBuild } from '../hooks/useDigiBuild'
import type { useDigiFirmware } from '../hooks/useDigiFirmware'
import { Icon } from './Icon'
import { BuildProgressIndicator } from './BuildProgressIndicator'

function save(data: BlobPart, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type })), link = document.createElement('a')
  link.href = url; link.download = name
  document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const kib = (bytes: number) => (bytes / 1024).toFixed(0) + ' KB'

export function DigiBuildPanel({ device, firmware, moduleIds, onExport, exported, canExport, results }: { device: { id: DigiMod['device']; name: string; firmware?: { recovery: string } }; firmware: ReturnType<typeof useDigiFirmware>; moduleIds: readonly string[]; onExport: () => void; exported: boolean; canExport: boolean; results: HTMLElement | null }) {
  const ready = firmware.state === 'ready' && !!firmware.file, release = ready ? firmware.firmware?.release : undefined
  const plan = release ? planBuild(device.id, release, moduleIds) : undefined
  const missing = plan?.missing.map(id => DIGI_MODS.find(mod => mod.device === device.id && mod.id === id)?.title ?? id) ?? []
  const { state, check, build, cancel } = useDigiBuild(device.id, ready && !missing.length ? firmware.file : undefined, release, moduleIds)
  const [version, setVersion] = useState(''), [accepted, setAccepted] = useState(''), [downloaded, setDownloaded] = useState('')
  const {followDownloads,followNotice}=useDownloadFollows()
  const deviceInfo = 'device' in state ? state.device : undefined, key = 'key' in state ? state.key : ''
  const shown = version || deviceInfo?.default_version || '2.0a', length = deviceInfo?.version_len ?? 4
  const result = state.phase === 'built' && state.result.version === shown ? state.result : undefined
  const downloadName = result ? 'Modwerk-' + device.id + '-' + result.files[0].name : ''
  const approvalKey = JSON.stringify([device.id,ready ? firmware.firmware?.sha256 : '',[...moduleIds].sort(),shown])
  const riskAccepted = accepted === approvalKey
  const versionError = /^[\x20-\x7e]*$/.test(shown) && shown.length === length ? '' : 'Use exactly ' + length + ' plain characters.'
  const busy = state.phase === 'loading' || state.phase === 'checking' || state.phase === 'building'
  const message = !ready ? 'Add your original ' + device.name + ' OS file under Base firmware. Builds run in this browser; nothing is uploaded.'
    : missing.length ? missing.join(', ') + (missing.length === 1 ? ' is' : ' are') + ' not available for OS ' + release + '. Remove ' + (missing.length === 1 ? 'it' : 'them') + ' or use another OS file.'
    : state.phase === 'idle' ? 'Check this selection with the builder. The first check loads the build engine once.'
    : state.phase === 'loading' ? 'Loading the build engine…'
    : state.phase === 'checking' ? 'Checking these mods together…'
    : state.phase === 'ready' ? (moduleIds.length ? 'Ready to build: the core and ' + moduleIds.length + (moduleIds.length === 1 ? ' mod fit' : ' mods fit') + ' together on OS ' + release + '.' : 'Ready to build the core alone on OS ' + release + '.')
    : state.phase === 'blocked' ? state.error
    : state.phase === 'building' ? state.log
    : state.phase === 'failed' ? state.error
    : state.phase !== 'built' ? ''
    : !result ? 'The displayed OS version changed. Build again to use the new version.'
    : 'Firmware built and verified: ' + downloadName + '.'
  // the engine's log of the last build, built or failed: shown under the result, and saved as text for bug reports
  const done = state.phase === 'built' || state.phase === 'failed' ? state : undefined
  const outcome = done?.result, lines = outcome?.log ?? []
  function saveLog() {
    if (!done || !outcome) return
    const text = buildLogText({ device: done.device.name, release: release ?? '', version: outcome.ok ? outcome.version : shown, enabled: done.enabled, result: outcome })
    save(text, (outcome.ok ? outcome.files[0].name.replace(/\.syx$/i, '') : device.id + '-build-failed') + '.log.txt', 'text/plain')
  }
  return <>
    <RiskAcceptance checked={riskAccepted} onChange={checked => setAccepted(checked ? approvalKey : '')}/>
    <section className="build-section" aria-labelledby="digi-build-title" aria-busy={busy}>
      <div><h2 id="digi-build-title">{result ? 'Firmware ready' : 'Build firmware'}</h2>
        <p id="digi-build-status" role={state.phase === 'blocked' || state.phase === 'failed' ? 'alert' : 'status'}>{message}</p>
        {state.phase === 'blocked' && state.check?.problems?.length ? <details className="build-report"><summary>Show the builder’s report</summary><ul className="build-problems">{state.check.problems.map(problem => <li key={problem}>{problem}</li>)}</ul></details> : null}
        {state.phase === 'building' && <BuildProgressIndicator phase={state.step} finished={false}/>}
        {result && <BuildProgressIndicator finished/>}
        <span className="subtle">No firmware upload. Local validation does not qualify this module set on hardware.</span>

        {(state.phase === 'ready' || state.phase === 'failed' || state.phase === 'built') && <label className="version-field build-version"><span>OS version shown on the unit</span>
          <input value={shown} maxLength={length} spellCheck={false} aria-invalid={!!versionError} aria-describedby="digi-version-help" onChange={event => setVersion(event.target.value)} />
          <small id="digi-version-help">{versionError || 'Shown instead of the stock version, so you can tell the builds apart.'}</small></label>}
      </div>
      <div className="build-actions">
        {busy ? <button className="button button-quiet" onClick={cancel}>Cancel build</button> : result && DIGI_DOWNLOADS_ENABLED ? <button className="button button-primary" disabled={!riskAccepted} onClick={() => { save(result.files[0].data, downloadName); setDownloaded(key); if (state.phase === 'built') { const ids=state.moduleIds.map(id => device.id + '-' + id);trackFirmwareDownload(ids, device.id);followDownloads(ids, { machine: device.name, os: release ?? '', modules: builtModules(ids) }) } }}><Icon name="download" size={16}/>Download .syx</button> : null}
        {!busy && (state.phase === 'ready' || state.phase === 'failed' || state.phase === 'built'
          ? <button className={'button ' + (result ? 'button-quiet' : 'button-primary')} disabled={!!versionError || !riskAccepted} onClick={() => void build(shown)} aria-describedby="digi-build-status"><Icon name="sliders" size={16} />{result ? 'Build again' : 'Build firmware'}</button>
          : <button className="button button-primary" disabled={!ready || !!missing.length || busy} onClick={() => void check()} aria-describedby="digi-build-status"><Icon name="check" size={16} />{state.phase === 'blocked' ? 'Check again' : 'Check selection'}</button>)}
        <button className="button button-quiet" disabled={!canExport} onClick={onExport}><Icon name="download" size={16}/>Export module set</button><p className="export-note" aria-live="polite">{exported ? 'Module set exported as JSON.' : 'JSON backup · no firmware included'}</p>
      </div>
    </section>
    <p className="file-footnote"><span>Builder: <a href={BUILDER_SOURCE.repository} target="_blank" rel="noreferrer">elekloader ↗</a> by irpina (GPL-3.0-or-later), with each mod’s pinned author release. It runs in this browser.</span></p>
    {/* The build card stays in the page's sticky column; what follows a build reads in the main column. */}
    {results && createPortal(<>
      {result && <div className="build-facts"><span>Size <strong>{kib(result.bytes)}</strong></span><span>OS version <strong>{result.version}</strong></span><span>Built in <strong>{result.seconds.toFixed(1)} s</strong></span></div>}
      {result && !DIGI_DOWNLOADS_ENABLED && <aside className="risk-note" role="note"><strong>Downloads open after review</strong><p>The build ran and verified in this browser. Modwerk will offer {device.name} firmware files once their release is approved. Nothing was uploaded.</p></aside>}
      {result && DIGI_DOWNLOADS_ENABLED && <section className="configuration-section install-guide" aria-labelledby="digi-install-title"><div className="section-title"><h2 id="digi-install-title">Install on your {device.name}</h2><span className="pill">{result.version}</span></div>
        <ol><li>Connect the {device.name} over USB and open Elektron Transfer.</li><li>Select the unit, connect, and drop the .syx onto Transfer.</li><li>Press YES on the unit and keep it powered until the update finishes.</li></ol>
        <p className="service-note">To go back: {result.recovery || device.firmware?.recovery}</p>
        <p className="service-note">{FLASHING_RISKS} Flash at your own risk. Local checks cannot guarantee hardware safety.</p>
        <p className="service-note">{FIRMWARE_SHARING_NOTICE}</p>
        {downloaded === key && <p className="success-note" role="status">Download requested. Check your browser’s downloads folder.</p>}{downloaded===key&&followNotice&&<p className="service-note" role="status">{followNotice}</p>}</section>}
      {result && DIGI_DOWNLOADS_ENABLED && downloaded === key && state.phase === 'built' && <DownloadedBuildOverview build={{ machine: device.name, os: release ?? '', modules: builtModules(state.moduleIds.map(id => device.id + '-' + id)) }}/>}
      {result && <section className="configuration-section"><details><summary>File identity &amp; builder</summary><dl className="build-identity">
        <dt>SHA-256</dt><dd>{result.sha256}</dd><dt>Mods</dt><dd>{result.mods.join(', ')}</dd>
        <dt>Builder</dt><dd><a href={BUILDER_SOURCE.repository + '/tree/' + BUILDER_SOURCE.commit} target="_blank" rel="noreferrer">elekloader {BUILDER_SOURCE.commit.slice(0, 7)} ↗</a> by irpina, GPL-3.0-or-later · <a href={assetUrl('licenses/THIRD_PARTY_NOTICES.html')} target="_blank" rel="noreferrer">Licence notices</a></dd>
      </dl></details></section>}
      {lines.length > 0 && <section className="configuration-section"><details open={state.phase === 'failed'}><summary>Build log</summary>
        <ol className="build-log">{lines.map(([seconds, line], index) => <li key={index}><span className="build-log-time">{seconds.toFixed(2)} s</span><span>{line}</span></li>)}</ol>
        <button className="button button-quiet" onClick={saveLog}><Icon name="download" size={16}/>Download build log</button>
      </details></section>}
    </>, results)}
  </>
}
