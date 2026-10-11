import { normalizeRemovedStockFx } from '../catalog/stock-effects'
import { useCommunity } from '../community/context'
import { hasBetaAccess } from '../community/beta-access'
import { trackConfigurationStarted } from '../community/usage'
import { useEffect, useRef, useState } from 'react'
import { afterDeleting, newConfiguration, cleanName, pinModuleVersions, configurationDevice, DEFAULT_DEVICE, removedSettings } from '../config/workspace'
import { DEVICES_BY_ID } from '../devices/registry'
import { isModuleAvailable } from '../catalog/availability'
import type { Configuration } from '../config/workspace'
import { deviceStore, openDeviceDatabase } from '../storage/device'
import type { DeviceStore } from '../storage/device'
import { createLazyFirmwareClient } from './firmware-client'
import type { FirmwareClient } from '../engine/client'
import type { FirmwareInspection } from '../engine/base'
import { parseUsbAudioConfiguration, USB_AUDIO_MODULE, type UsbAudioConfiguration } from '../config/usb-audio'

export function useWorkspace() {
  const betaAccess = hasBetaAccess(useCommunity().session)
  const [configurations, setConfigurations] = useState<Configuration[]>([])
  const [activeId, setActiveId] = useState('')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [unreadable, setUnreadable] = useState(0)
  const [firmware, setFirmware] = useState<FirmwareInspection | null>(null)
  const [fileState, setFileState] = useState<'empty' | 'reading' | 'ready' | 'error'>('empty')
  const [fileError, setFileError] = useState('')
  const [firmwareSaved, setFirmwareSaved] = useState(false)
  const storeRef = useRef<DeviceStore | null>(null)
  const clientRef = useRef<FirmwareClient | null>(null)
  const generation = useRef(0)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const alive = useRef(false)
  const active = configurations.find(item => item.id === activeId)
  const configsRef = useRef(configurations)
  const activeRef = useRef(activeId)

  function replaceConfigurations(items: Configuration[]) { configsRef.current = items; setConfigurations(items) }
  function changeActive(id: string) { activeRef.current = id; setActiveId(id) }

  useEffect(() => {
    let cancelled = false
    const requestGeneration = generation
    alive.current = true
    const client = createLazyFirmwareClient()
    clientRef.current = client
    let database: IDBDatabase | undefined
    void (async () => {
      try {
        const db = await openDeviceDatabase()
        if (cancelled) { db.close(); return }
        database = db
        const store = deviceStore(db)
        storeRef.current = store
        let skipped = 0
        let items = await store.listConfigurations(() => skipped++)
        setUnreadable(skipped)
        if (!items.length) { const item = newConfiguration('My first module set'); await store.saveConfiguration(item); items = [item] }
        const rememberedId = await store.activeConfiguration()
        if (cancelled) return
        replaceConfigurations(items)
        changeActive(items.some(item => item.id === rememberedId) ? rememberedId! : items[0].id)
        const stored = await store.readFirmware()
        if (cancelled) return
        if (stored) {
          setFileState('reading')
          try {
            const verified = await client.inspect(new File([stored.blob], stored.name))
            if (cancelled) return
            setFirmware(verified); setFirmwareSaved(true); setFileState('ready')
          } catch {
            if (!cancelled) { setFileState('error'); setFileError('The saved firmware could not be verified. Choose the original 1.40C file again.'); await store.forgetFirmware() }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setStorageError('Device storage could not be opened. Changes are not saved. ' + (error instanceof Error ? error.message : ''))
          const fallback = newConfiguration('Unsaved module set')
          replaceConfigurations([fallback]); changeActive(fallback.id)
        }
      } finally { if (!cancelled) setReady(true) }
    })()
    return () => { cancelled = true; alive.current = false; ++requestGeneration.current; client.dispose(); clientRef.current = null; storeRef.current = null; database?.close() }
  }, [])

  function persist(operation: (store: DeviceStore) => Promise<void>) {
    setSaving(true)
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (!storeRef.current) throw new Error('Browser storage is unavailable.')
      await operation(storeRef.current)
    }).catch(error => { if (alive.current) setStorageError('Not saved on this device. ' + (error instanceof Error ? error.message : 'Try exporting your module set.')) })
    const latest = saveQueue.current
    void latest.finally(() => { if (alive.current && saveQueue.current === latest) setSaving(false) })
  }
  function selectConfiguration(id: string) {
    if (!configsRef.current.some(item => item.id === id)) return
    changeActive(id)
    persist(store => store.setActiveConfiguration(id))
  }
  function createConfiguration(name: string, copy = false, device = DEFAULT_DEVICE) {
    const original = configsRef.current.find(item => item.id === activeRef.current)
    const source = copy && original && configurationDevice(original) === device ? original : undefined
    const item = { ...newConfiguration(name, source?.moduleIds, source?.keepStockFx2 ?? true, source?.moduleVersions, device, source?.usbAudio), ...removedSettings(device, source?.removedStockFx) }
    replaceConfigurations([...configsRef.current, item]); changeActive(item.id)
    persist(async store => { await store.saveConfiguration(item); await store.setActiveConfiguration(item.id) })
    if(item.moduleIds.length)trackConfigurationStarted(item.id)
    return item
  }
  function importConfiguration(name: string, ids: string[], keepStockFx2 = true, moduleVersions?: Record<string,string>, device = DEFAULT_DEVICE, usbAudio?: UsbAudioConfiguration, removedStockFx?: string[]) {
    const item = { ...newConfiguration(name, ids, keepStockFx2, moduleVersions, device, usbAudio), ...removedSettings(device, removedStockFx) }
    replaceConfigurations([...configsRef.current,item]);changeActive(item.id)
    if(item.moduleIds.length)trackConfigurationStarted(item.id)
    persist(async store => {await store.saveConfiguration(item);await store.setActiveConfiguration(item.id)})
  }
  function updateActive(update: Partial<Pick<Configuration, 'name' | 'moduleIds' | 'moduleVersions' | 'keepStockFx2' | 'usbAudio' | 'removedStockFx'>>) {
    const current = configsRef.current.find(item => item.id === activeRef.current)
    if (!current) return
    const updated = { ...current, ...update, updatedAt: new Date().toISOString() }
    replaceConfigurations(configsRef.current.map(item => item.id === updated.id ? updated : item))
    persist(store => store.saveConfiguration(updated))
  }
  function renameConfiguration(name: string) { updateActive({ name: cleanName(name) }) }
  // Adding a module edits the machine's active configuration, creating the machine's first one when needed.
  function configurationFor(device: string) {
    const active = configsRef.current.find(item => item.id === activeRef.current)
    if (active && configurationDevice(active) === device) return active
    const latest = configsRef.current.filter(item => configurationDevice(item) === device).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (latest) { selectConfiguration(latest.id); return latest }
    return createConfiguration('My ' + (DEVICES_BY_ID[device]?.name ?? 'first') + ' configuration', false, device)
  }
  function toggleModule(id: string, device = DEFAULT_DEVICE) {
    const current = configurationFor(device)
    // USB is added atomically with the user's setup through configureUsbAudio.
    if (device === DEFAULT_DEVICE && id === USB_AUDIO_MODULE && !current.moduleIds.includes(id)) return
    if (!current.moduleIds.includes(id) && device === DEFAULT_DEVICE && !isModuleAvailable(id, betaAccess)) return
    const moduleIds = current.moduleIds.includes(id) ? current.moduleIds.filter(value => value !== id) : [...current.moduleIds, id]
    const moduleVersions = Object.fromEntries(moduleIds.map(selected=>[selected,current.moduleVersions[selected]??pinModuleVersions([selected],device)[selected]]))
    updateActive({ moduleIds, moduleVersions, ...(id === USB_AUDIO_MODULE && !moduleIds.includes(id) ? { usbAudio: undefined } : {}) })
    if(!current.moduleIds.length&&moduleIds.length)trackConfigurationStarted(current.id)
  }
  function configureUsbAudio(usbAudio: UsbAudioConfiguration | undefined) {
    const current = configurationFor(DEFAULT_DEVICE)
    const moduleIds = current.moduleIds.includes(USB_AUDIO_MODULE) ? current.moduleIds : [...current.moduleIds, USB_AUDIO_MODULE]
    updateActive({ moduleIds, moduleVersions: { ...current.moduleVersions, ...pinModuleVersions([USB_AUDIO_MODULE]) }, usbAudio: usbAudio ? parseUsbAudioConfiguration(usbAudio) : undefined })
    if (!current.moduleIds.length) trackConfigurationStarted(current.id)
  }
  function deleteConfiguration() {
    const deleting = activeRef.current
    const { remaining, next } = afterDeleting(configsRef.current, deleting)
    replaceConfigurations(remaining); changeActive(next.id)
    persist(async store => {
      await store.saveConfiguration(next)
      await store.setActiveConfiguration(next.id)
      await store.deleteConfiguration(deleting)
    })
  }
  async function readFile(file: File) {
    const request = ++generation.current
    setFileState('reading'); setFirmware(null); setFirmwareSaved(false); setFileError('')
    try {
      const client = clientRef.current
      if (!client) throw new Error('The firmware reader is not ready.')
      await client.clear()
      if (request !== generation.current) return
      // Queue removal first: an invalid replacement must not restore an older file next session.
      persist(store => store.forgetFirmware())
      const inspection = await client.inspect(file)
      if (request !== generation.current) return
      setFirmware(inspection); setFileState('ready')
      persist(async store => {
        await store.saveFirmware(file)
        if (alive.current && request === generation.current) setFirmwareSaved(true)
      })
    } catch (error) {
      if (request !== generation.current) return
      setFileState('error'); setFileError(error instanceof Error ? error.message : 'Unable to read this file.')
    }
  }
  function clearFile() {
    ++generation.current
    setFirmware(null); setFirmwareSaved(false); setFileState('empty'); setFileError('')
    persist(store => store.forgetFirmware())
    void clientRef.current?.clear().catch(() => setFileError('The firmware reader stopped. Reload the page.'))
  }
  return { firmwareClient: clientRef, setKeepStockFx2: (keepStockFx2: boolean) => updateActive({ keepStockFx2 }), setRemovedStockFx: (keys: string[]) => updateActive({ removedStockFx: normalizeRemovedStockFx(keys) }), configureUsbAudio, importConfiguration, configurations, active, ready, saving, storageError, unreadable, selectConfiguration, createConfiguration, renameConfiguration, deleteConfiguration, toggleModule, firmware, fileState, fileError, setFileError, firmwareSaved, readFile, clearFile }
}
