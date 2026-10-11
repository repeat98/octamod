import { normalizeRemovedStockFx } from '../catalog/stock-effects'
import { DSP_LOADER } from '../engine/protocol'
import { CATALOG_SOURCE, resolveSelection } from '../catalog/modules'
import { BASE_FIRMWARE, type FirmwareInspection } from '../engine/base'
import { cleanName, pinModuleVersions, normalizeModuleVersions } from './workspace'
import { parseUsbAudioConfiguration, USB_AUDIO_MODULE, type UsbAudioConfiguration } from './usb-audio'

export function createSelection(ids: readonly string[], firmware: FirmwareInspection | null, keepStockFx2 = DSP_LOADER, moduleVersions = pinModuleVersions(ids), usbAudio?: UsbAudioConfiguration, removedStockFx?: string[]) {
  if (usbAudio && !ids.includes(USB_AUDIO_MODULE)) throw new Error('USB Audio settings require the USB Audio module.')
  return {
    schemaVersion: usbAudio ? 4 : 3,
    options: { keepStockFx2, ...(usbAudio ? { usbAudio: parseUsbAudioConfiguration(usbAudio) } : {}), ...(removedStockFx?.length ? { removedStockFx } : {}) },
    app: 'octamod',
    catalog: CATALOG_SOURCE,
    base: firmware
      ? { version: firmware.version, sha256: firmware.sha256, bytes: firmware.bytes }
      : null,
    modules: resolveSelection(ids).map((module) => ({ id: module.id, key: module.key, version: moduleVersions[module.id] })),
    validation: 'pending',
  }
}

export function downloadSelection(ids: readonly string[], firmware: FirmwareInspection | null, name = "Octamod configuration", keepStockFx2 = DSP_LOADER, moduleVersions = pinModuleVersions(ids), usbAudio?: UsbAudioConfiguration, removedStockFx?: string[]) {
  const blob = new Blob([JSON.stringify({ ...createSelection(ids, firmware, keepStockFx2, moduleVersions, usbAudio, removedStockFx), name }, null, 2) + '\n'], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = (name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'octamod') + '.json'
  document.body.append(link)
  link.click()
  link.remove()
  // Give Safari time to begin reading the object URL before releasing it.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parseSelection(text: string) {
  if (new TextEncoder().encode(text).length > 32 * 1024) throw new Error('Configuration backups must be smaller than 32 KB.')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('This file is not valid configuration JSON.') }
  if (!value || typeof value !== 'object') throw new Error('Choose an Octamod configuration backup.')
  const item = value as { app?: unknown; schemaVersion?: unknown; name?: unknown; catalog?: { revision?: unknown }; base?: { sha256?: unknown }; modules?: { id?: unknown; version?: unknown }[]; options?: { keepStockFx2?: unknown; usbAudio?: unknown } }
  if (item.app !== 'octamod' || ![1, 2, 3, 4].includes(Number(item.schemaVersion)) || typeof item.name !== 'string' || !Array.isArray(item.modules) || item.modules.length > 100 || item.modules.some(module => !module || typeof module.id !== 'string')) throw new Error('Choose an Octamod configuration backup.')
  if (item.catalog?.revision !== CATALOG_SOURCE.revision) throw new Error('This backup uses a different module catalog. Review its modules before creating a new configuration.')
  if (item.base && item.base.sha256 !== BASE_FIRMWARE.sha256) throw new Error('This backup uses a different base firmware. Octamod currently supports original OS 1.40C.')
  const keepStockFx2 = item.schemaVersion === 1 ? true : item.options?.keepStockFx2
  if (typeof keepStockFx2 !== 'boolean') throw new Error('The backup has an unreadable chooser setting.')
  const ids = resolveSelection(item.modules.map(module=>module.id as string)).map(module=>module.id)
  const pins = Number(item.schemaVersion)>=3 ? Object.fromEntries(item.modules.map(module=>{if(typeof module.version!=='string')throw new Error('This backup is missing module versions.');return [module.id,module.version]})) : undefined
  if (item.options?.usbAudio !== undefined && (item.schemaVersion !== 4 || !ids.includes(USB_AUDIO_MODULE))) throw new Error('USB Audio settings require a version 4 backup with USB Audio selected.')
  const usbAudio = item.options?.usbAudio === undefined ? undefined : parseUsbAudioConfiguration(item.options.usbAudio)
  const removedStockFx = normalizeRemovedStockFx((item.options as { removedStockFx?: unknown } | undefined)?.removedStockFx)
  return { moduleVersions: normalizeModuleVersions(ids,pins), name: cleanName(item.name), moduleIds: ids, keepStockFx2, ...(usbAudio ? { usbAudio } : {}), ...(removedStockFx ? { removedStockFx } : {}) }
}
