import { useState } from 'react'
import { configurationDevice, type Configuration } from '../config/workspace'
import { DEVICES, DEVICES_BY_ID } from '../devices/registry'
import { Icon } from './Icon'

/** Your module sets, at the top of the Module sets page: search, filter by machine, open one or start a new one. */
export function ModuleSetList({ configurations, activeId, currentDevice, onSelect, onCreate }: { configurations: Configuration[]; activeId?: string; currentDevice: string; onSelect: (id: string) => void; onCreate: (device: string) => void }) {
  const [query, setQuery] = useState('')
  const [machine, setMachine] = useState('all')
  const term = query.trim().toLowerCase()
  const machines = DEVICES.filter(device => device.status === 'available' || device.status === 'preview' || configurations.some(item => configurationDevice(item) === device.id))
  const items = configurations.filter(item => (machine === 'all' || configurationDevice(item) === machine) && (item.name + ' ' + DEVICES_BY_ID[configurationDevice(item)].name).toLowerCase().includes(term))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
  const createDevice = DEVICES_BY_ID[machine === 'all' ? currentDevice : machine]
  const canCreate = createDevice.status === 'available' || createDevice.status === 'preview'
  return <section className="configuration-section configuration-browser your-module-sets" aria-labelledby="your-sets-title">
    <div className="configuration-browser-heading"><h2 id="your-sets-title">Your module sets <span className="subtle">{configurations.length}</span></h2><button type="button" className="button button-quiet" disabled={!canCreate} onClick={() => onCreate(createDevice.id)}><Icon name="plus" size={16} />New {createDevice.name} module set</button></div>
    {configurations.length > 4 && <div className="configuration-browser-tools"><label className="configuration-search"><Icon name="search" size={16} /><span className="sr-only">Search module sets</span><input type="search" placeholder="Search module sets" value={query} onChange={event => setQuery(event.target.value)} /></label><label><span className="sr-only">Filter module sets by machine</span><select value={machine} onChange={event => setMachine(event.target.value)}><option value="all">All machines</option>{machines.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label></div>}
    <div className="configuration-browser-list"><ul aria-label="Your module sets">{items.map(item => {
      const device = DEVICES_BY_ID[configurationDevice(item)], active = item.id === activeId
      return <li key={item.id}><button type="button" aria-current={active || undefined} onClick={() => onSelect(item.id)}><Icon name="file" size={18} /><span><strong>{item.name}</strong><small>{device.name} · {item.moduleIds.length} {item.moduleIds.length === 1 ? 'module' : 'modules'}</small></span>{active && <span className="configuration-current"><Icon name="check" size={14} />Current</span>}<Icon name="arrow" size={15} /></button></li>
    })}</ul>{!items.length && <div className="configuration-browser-empty"><strong>{configurations.length ? 'No module sets found' : 'No module sets yet'}</strong><p>{configurations.length ? 'Try another name or machine.' : 'Start one, or copy a starting point below.'}</p></div>}</div>
  </section>
}
