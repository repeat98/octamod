import { moduleHref } from '../routing'
import { useEffect, useRef } from 'react'
import { MODULES } from '../catalog/modules'
import { isModuleAvailable } from '../catalog/availability'
import { RESOURCES } from '../catalog/resources'
import { MODULE_DOCUMENTS_BY_ID } from '../catalog/documents'
import { moduleBuildPending } from '../catalog/build-support'
import { DIGI_MODS, type DigiMod } from '../devices/digi-mods'
import { DEVICES_BY_ID, deviceHref } from '../devices/registry'
import { DIGI_DOWNLOADS_ENABLED } from '../engine/elekloader/protocol'
import { USB_AUDIO_MODULE } from '../config/usb-audio'

const ROWS = ['Machine', 'Version', 'Purpose', 'Location', 'Storage', 'Processing', 'Hardware record', 'Build status'] as const

type ComparisonProps = {
  ids: string[]
  selected: string[]
  digiSelected: Record<DigiMod['device'], string[]>
  onToggle: (id: string) => void
  onToggleDigi: (device: DigiMod['device'], id: string) => void
  onClose: () => void
}

export function ModuleComparison({ ids, onClose, onToggle, selected, digiSelected, onToggleDigi }: ComparisonProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const modules = [
    ...MODULES.filter(module => isModuleAvailable(module.id)).map(module => ({
      key: module.id, name: module.name, author: module.authorName, authorUrl: module.authorUrl,
      href: moduleHref(module.id), selected: selected.includes(module.id), toggle: () => onToggle(module.id),
      values: {
        Machine: 'Octatrack', Version: 'v' + module.version, Purpose: module.description, Location: module.detail,
        Storage: RESOURCES[module.id].memory.value, Processing: RESOURCES[module.id].compute.value,
        'Hardware record': MODULE_DOCUMENTS_BY_ID[module.id].tests.hardwareStatus === 'reported' ? 'Author-reported functional hardware test' : MODULE_DOCUMENTS_BY_ID[module.id].tests.hardwareStatus !== 'untested' ? 'Earlier hardware evidence; current catalog unqualified' : 'No hardware qualification',
        'Build status': moduleBuildPending(module.id) ? 'Verification pending' : 'Experimental',
      },
    })),
    ...DIGI_MODS.map(module => ({
      key: module.device + '-' + module.id, name: module.title, author: module.author, authorUrl: module.repository,
      href: deviceHref(module.device, 'module/' + module.id), selected: digiSelected[module.device].includes(module.id), toggle: () => onToggleDigi(module.device, module.id),
      values: {
        Machine: DEVICES_BY_ID[module.device].name, Version: 'v' + module.version, Purpose: module.summary,
        Location: module.category + ' · OS ' + module.releases.join(' / '),
        Storage: (module.ramBytes / 1024).toFixed(module.ramBytes < 10240 ? 1 : 0) + ' KiB (code and data)',
        Processing: 'Not measured', 'Hardware record': module.hardware ?? 'No hardware report yet',
        'Build status': DIGI_DOWNLOADS_ENABLED ? 'Experimental' : 'Verification pending',
      },
    })),
  ].filter(module => ids.includes(module.key))
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="comparison-dialog" aria-labelledby="comparison-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="section-title"><h2 id="comparison-title">Compare modules</h2><button className="icon-button" onClick={onClose} aria-label="Close comparison">×</button></div>
    <div className="comparison-scroll" tabIndex={0} role="region" aria-label="Module comparison table"><table>
      <thead><tr><th scope="col">Module</th>{modules.map(module => <th scope="col" key={module.key}><a href={module.href} onClick={onClose}>{module.name} ↗</a><small>by <a href={module.authorUrl} target="_blank" rel="noreferrer">{module.author}</a></small></th>)}</tr></thead>
      <tbody>{ROWS.map(label => <tr key={label}><th scope="row">{label}</th>{modules.map(module => <td key={module.key}>{module.values[label]}</td>)}</tr>)}
        <tr><th scope="row">Module set</th>{modules.map(module => <td key={module.key}><button className="button button-quiet" aria-pressed={!module.selected && module.key === USB_AUDIO_MODULE ? undefined : module.selected} onClick={module.toggle}>{module.selected ? 'Added' : (module.key === USB_AUDIO_MODULE ? 'Configure ' : 'Add ') + module.name}</button></td>)}</tr>
      </tbody>
    </table></div>
    <p className="service-note">Storage and processing values use different measurement methods. Open each module for conditions and test evidence. Adding a module updates its machine’s configuration.</p>
  </dialog>
}
