import { DownloadedBuildOverview } from '../community/HardwareFeedbackCheckIn'
import { builtModules } from '../community/build-follow-up'
import { useDownloadFollows } from '../community/useDownloadFollows'
import { trackFirmwareDownload } from '../community/usage'
import { saveFirmware } from '../config/firmware-filename'
import { FLASHING_RISKS, FIRMWARE_SHARING_NOTICE } from '../firmware-notices'
import { assetUrl } from '../hosting'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { useFirmwareBuild } from '../hooks/useFirmwareBuild'
import { BuildProgressIndicator } from './BuildProgressIndicator'
import { FirmwareDownloadDialog } from './FirmwareDownloadDialog'
import { Icon } from './Icon'
// Only the FX2-only reverbs give up their space selectively; any other omission is the compact FX2 menu.
const REVERB_NAMES:Record<string,string>={'SPRING REV':'Spring Reverb','PLATE REV':'Plate Reverb','DARK REV':'Dark Reverb'}
function omittedLabel(keys:readonly string[]){return keys.every(key=>key in REVERB_NAMES)?keys.map(key=>REVERB_NAMES[key]).join(', '):'Original effects'}
export function FirmwareBuildPanel({build,available,downloadsEnabled,firmwareReady,moduleCount,riskAccepted,configurationName,onExport,exported,results}:{build:ReturnType<typeof useFirmwareBuild>;available:boolean;downloadsEnabled:boolean;firmwareReady:boolean;moduleCount:number;riskAccepted:boolean;configurationName:string;onExport:()=>void;exported:boolean;results:HTMLElement|null}){
  const [downloadedKey,setDownloadedKey]=useState('')
  const [pendingDownload,setPendingDownload]=useState<typeof build.result>()
  const {followDownloads,followNotice}=useDownloadFollows()
  const progress=build.phase==='packing'?'Packing your firmware…':build.phase==='verifying'?'Verifying the finished file…':'Composing your selected modules…'
  const ready=build.state==='valid',finished=build.state==='built'&&!!build.result
  function downloadFirmware() {
    if (!finished || !downloadsEnabled || !riskAccepted || !pendingDownload || pendingDownload !== build.result) return
    saveFirmware(pendingDownload.buffer,configurationName,pendingDownload.sha256)
    setPendingDownload(undefined)
    setDownloadedKey(build.key)
    trackFirmwareDownload(build.report?.moduleIds??[], 'octatrack')
    followDownloads(build.report?.moduleIds??[], { machine: 'Octatrack', os: '1.40C', modules: builtModules(build.report?.moduleIds??[], build.report?.moduleVersions) })
  }
  const message=build.state==='error'?build.error:!firmwareReady?'Choose your original OS 1.40C file first.':!moduleCount?'Add at least one module from the library.':build.state==='validating'?'Checking whether these modules fit…':build.state==='building'?progress:finished&&!downloadsEnabled?'This module set builds and passes its local checks. Downloads are paused, so no file is offered.':finished?'Firmware is ready. The finished file passed its local packaging integrity check.':downloadsEnabled?'This selection fits. Build it locally when you’re ready.':'This selection fits. Firmware downloads are awaiting verification.'
  return <>
    {!downloadsEnabled&&<aside className="risk-note" role="note"><strong>Firmware downloads are paused</strong><p>Downloads remain paused while the updated firmware build is reviewed. Local compatibility checks remain available. Firmware files will be offered after verification.</p></aside>}
    <section className="build-section" aria-labelledby="build-title" aria-busy={build.state==='building'||build.state==='validating'}>
      <div><h2 id="build-title">{finished?'Firmware ready':'Build firmware'}</h2><p id="engine-status" role={build.state==='error'?'alert':'status'}>{message}</p>{(build.state==='building'||finished)&&<BuildProgressIndicator phase={build.phase} finished={finished}/>}<span className="subtle">No firmware upload. Local validation does not qualify this module set on hardware.</span></div>
      <div className="build-actions">
        {build.state==='building'?<button className="button button-quiet" onClick={build.cancel}>Cancel build</button>:finished&&!downloadsEnabled?null:finished?<button className="button button-primary" disabled={!riskAccepted} aria-describedby="engine-status" aria-haspopup="dialog" onClick={()=>setPendingDownload(build.result)}><Icon name="download" size={16}/>Download .bin</button>:<button className="button button-primary" disabled={!available||!downloadsEnabled||!ready||!riskAccepted} onClick={()=>void build.build()} aria-describedby="engine-status"><Icon name="sliders" size={16}/>Build firmware</button>}
        {build.state==='error'&&build.canRetry&&<button className="button button-quiet" onClick={build.retry}>Check again</button>}
        <button className="button button-quiet" onClick={onExport}><Icon name="download" size={16}/>Export module set</button><p className="export-note" aria-live="polite">{exported?'Module set exported as JSON.':'JSON backup · no firmware included'}</p>
      </div>
    </section>
    {finished&&downloadsEnabled&&riskAccepted&&pendingDownload&&pendingDownload===build.result&&<FirmwareDownloadDialog onDownload={downloadFirmware} onClose={()=>setPendingDownload(undefined)}/>}
    {/* The build card stays in the page's sticky column; what follows a build reads in the main column. */}
    {results&&createPortal(<>
    {build.report&&<div className="build-facts"><span>FX1 <strong>{build.report.fx1Rows} {build.report.fx1Rows===1?'effect':'effects'}</strong></span><span>FX2 <strong>{build.report.fx2Rows} {build.report.fx2Rows===1?'effect':'effects'}</strong></span>{build.report.omittedStockFx2.length>0&&<span>Not in FX2 <strong>{omittedLabel(build.report.omittedStockFx2)}</strong></span>}<span>OS image <strong>{(build.report.osBytes/1024).toFixed(1)} KB</strong></span>{finished&&<span>Finished file <strong>{(build.result!.buffer.byteLength/1024).toFixed(1)} KB</strong></span>}</div>}
    {finished&&downloadsEnabled&&<section className="configuration-section install-guide" aria-labelledby="install-title"><div className="section-title"><h2 id="install-title">Install on your Octatrack</h2><span className="pill">{build.report?.version}</span></div><p className="service-note">Keep your original OS 1.40C file and back up projects, banks and samples. This module set reserves {((build.report?.reservedBytes??0)/1024).toFixed(0)} KB of sample memory, including the built-in logger. {build.report?.moduleIds.includes('midi-scenes')&&'MIDI Scenes uses additional working memory; its complete memory bounds remain unverified.'}</p><ol><li>Download the .bin and copy it to the root of the Octatrack’s CompactFlash card.</li><li>Unmount the card safely, then choose OS UPGRADE from the Octatrack’s system settings and confirm the prompts. Follow the manual for your model. Use a stable power supply and never interrupt an update.</li><li>After updating, confirm the displayed OS version, create and open a fresh project, and test the selected effects before using the firmware in a live set.</li></ol><p><a href="https://www.elektron.se/wp-content/uploads/2024/09/Octatrack-MKII-User-Manual_ENG_OS1.40A_210414.pdf" target="_blank" rel="noreferrer">Official MKII manual, §8.5.2 ↗</a> · <a href="https://www.elektron.se/wp-content/uploads/2024/09/Octatrack-User-Manual_ENG-OS1.40A_220204.pdf" target="_blank" rel="noreferrer">MKI manual, §8.5.2 ↗</a></p><p className="service-note">{FLASHING_RISKS} Flash at your own risk. Emulator evidence and local integrity checks cannot guarantee hardware safety.</p><p className="service-note">{FIRMWARE_SHARING_NOTICE}</p><p><a href={assetUrl('licenses/THIRD_PARTY_NOTICES.txt')} download="THIRD_PARTY_NOTICES.txt">Download copyright &amp; licence notices</a> · Keep these notices with any permitted module distribution.</p>{downloadedKey===build.key&&<p className="success-note" role="status">Download requested. Check your browser’s downloads folder before copying the file.</p>}{downloadedKey===build.key&&followNotice&&<p className="service-note" role="status">{followNotice}</p>}</section>}
    {finished&&downloadsEnabled&&downloadedKey===build.key&&<DownloadedBuildOverview build={{ machine: 'Octatrack', os: '1.40C', modules: builtModules(build.report?.moduleIds??[],build.report?.moduleVersions) }}/>}
    {finished&&<section className="configuration-section"><details><summary>File identity & source revision</summary><dl className="build-identity"><dt>SHA-256</dt><dd>{build.result!.sha256}</dd><dt>Module versions</dt><dd>{Object.entries(build.report?.moduleVersions??{}).map(([id,version])=>id+' '+version).join(', ')}</dd><dt>Source commit</dt><dd>{build.report?.sourceCommit??'Local development build'}</dd><dt>Source fingerprint</dt><dd>{build.report?.sourceTreeSha256}</dd><dt>Native profile</dt><dd>{build.report?.revision}</dd></dl></details></section>}
    </>,results)}
  </>
}
