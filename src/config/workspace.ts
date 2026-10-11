import { DSP_LOADER } from '../engine/protocol'
import { normalizeRemovedStockFx } from '../catalog/stock-effects'
import { resolveSelection } from '../catalog/modules'
import { compareModuleVersions } from '../catalog/versions'
import { isDigiDevice, resolveDigiSelection } from '../devices/digi-mods'
import { parseUsbAudioConfiguration, USB_AUDIO_MODULE, type UsbAudioConfiguration } from './usb-audio'

export const DEFAULT_DEVICE = 'octatrack'
// Configurations saved before machines existed have no device: they are Octatrack configurations.
export function configurationDevice(item: { device?: string }) { return item.device ?? DEFAULT_DEVICE }
function resolveIds(ids: readonly string[], device: string): { id: string; version: string }[] {
  if (device === DEFAULT_DEVICE) return resolveSelection(ids)
  if (!isDigiDevice(device)) throw new Error('A saved module set is for an unknown machine.')
  return resolveDigiSelection(device, ids)
}

function deviceId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')
}

export type Configuration = { id: string; name: string; device?: string; moduleIds: string[]; moduleVersions: Record<string,string>; keepStockFx2: boolean; usbAudio?: UsbAudioConfiguration; /** Octatrack stock effects left out of the menus when loaded over USB. */ removedStockFx?: string[]; createdAt: string; updatedAt: string }
/** What stays open after deleting a configuration: another one for the same machine, else any other, else a new empty one for
 * that machine, so deleting a machine's last configuration never creates one for a different machine. */
export function afterDeleting(configurations: Configuration[], id: string) {
  const deleted = configurations.find(item => item.id === id), device = deleted ? configurationDevice(deleted) : DEFAULT_DEVICE
  const remaining = configurations.filter(item => item.id !== id)
  const next = remaining.find(item => configurationDevice(item) === device) ?? remaining[0] ?? newConfiguration('My module set', [], DSP_LOADER, undefined, device)
  return { remaining: remaining.includes(next) ? remaining : [...remaining, next], next }
}
export function newConfiguration(name: string, moduleIds: string[] = [], keepStockFx2 = DSP_LOADER, moduleVersions?: Record<string,string>, device = DEFAULT_DEVICE, usbAudio?: UsbAudioConfiguration): Configuration {
  const now = new Date().toISOString()
  return { id: deviceId(), name: cleanName(name), ...(device === DEFAULT_DEVICE ? {} : { device }), moduleIds: resolveIds(moduleIds, device).map(m => m.id), moduleVersions: moduleVersions ? normalizeModuleVersions(moduleIds,moduleVersions,device) : pinModuleVersions(moduleIds,device), keepStockFx2, ...usbSettings(moduleIds, device, usbAudio), createdAt: now, updatedAt: now }
}
export function removedSettings(device: string, value: unknown) {
  const removedStockFx = device === DEFAULT_DEVICE ? normalizeRemovedStockFx(value) : undefined
  return removedStockFx ? { removedStockFx } : {}
}
function usbSettings(ids: readonly string[], device: string, value: unknown) {
  if (value === undefined) return {}
  if (device !== DEFAULT_DEVICE || !ids.includes(USB_AUDIO_MODULE)) throw new Error('USB Audio settings require the Octatrack USB Audio module.')
  return { usbAudio: parseUsbAudioConfiguration(value) }
}
export function cleanName(name: string) {
  const value = name.trim()
  if (!value || value.length > 80) throw new Error('Use a module set name between 1 and 80 characters.')
  return value
}
export function validateConfiguration(value: unknown): Configuration {
  if (!value || typeof value !== 'object') throw new Error('A saved module set is unreadable.')
  const item = value as Configuration
  if (item.keepStockFx2 !== undefined && typeof item.keepStockFx2 !== 'boolean') throw new Error('A saved chooser setting is unreadable.')
  if (item.device !== undefined && (typeof item.device !== 'string' || !isDigiDevice(item.device))) throw new Error('A saved module set is for an unknown machine.')
  if (typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !Array.isArray(item.moduleIds) || !item.moduleIds.every(id => typeof id === 'string') || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') throw new Error('A saved module set is unreadable.')
  const device = configurationDevice(item)
  return { id: item.id, name: cleanName(item.name), ...(device === DEFAULT_DEVICE ? {} : { device }), moduleIds: resolveIds(item.moduleIds, device).map(m => m.id), moduleVersions: normalizeModuleVersions(item.moduleIds,item.moduleVersions,device), keepStockFx2: item.keepStockFx2 ?? true, ...removedSettings(device, item.removedStockFx), ...usbSettings(item.moduleIds, device, item.usbAudio), createdAt: item.createdAt, updatedAt: item.updatedAt }
}

export function pinModuleVersions(ids: readonly string[], device = DEFAULT_DEVICE): Record<string,string> {return Object.fromEntries(resolveIds(ids,device).map(module=>[module.id,module.version]))}
// Saved configurations and backups select modules; builds always use the current catalog versions.
export function normalizeModuleVersions(ids: readonly string[], value: unknown, device = DEFAULT_DEVICE): Record<string,string> {
  const modules=resolveIds(ids,device)
  if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('Saved module versions are unreadable.')
  const pins=(value??{}) as Record<string,unknown>
  for(const key of Object.keys(pins))if(!ids.includes(key))throw new Error('Saved version belongs to an unselected module.')
  return Object.fromEntries(modules.map(module=>{const version=pins[module.id]??module.version;if(typeof version!=='string')throw new Error('Saved module version is unreadable.');compareModuleVersions(version,version);return [module.id,module.version]}))
}
