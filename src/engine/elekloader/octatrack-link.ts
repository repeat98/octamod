// SPDX-License-Identifier: GPL-3.0-or-later
// The site's USB link to an Octatrack running the Modwerk base: find the unit,
// send one runtime module, run it as a trial, then keep or undo it. The base
// itself undoes anything not kept when USB goes quiet or away, so every
// failure here ends in "unplug to undo" at worst.
import { sha } from '../../../vendor/elekloader/kit/src/bytes.ts'
import { UploadDeviceError, UploadSession, UploadUnconfirmedError } from './upload-session.ts'
import type { UploadResultName } from './upload-wire.ts'
import { findVendorInterface, UsbVendorTransport, type ControlDevice, type VendorIdentity } from './upload-usb.ts'

export const ELEKTRON_VENDOR_ID = 0x1935
/** Well inside the base's 10 s quiet limit (sdk/runtime/upload/vendor.c mv_tick); any vendor request counts. */
const KEEPALIVE_MS = 1000
/** Asked while playing, the base presses STOP itself and answers `unsafe` that once; ask again until it has stopped. */
const STOP_RETRY_MS = 200
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// lib.dom has no WebUSB types; only what the link calls.
export interface LinkDevice extends ControlDevice {
  readonly configuration: Parameters<typeof findVendorInterface>[0]
  readonly opened: boolean
  open(): Promise<void>; close(): Promise<void>
  selectConfiguration(value: number): Promise<void>
  claimInterface(index: number): Promise<void>; releaseInterface(index: number): Promise<void>
}
type DeviceListener = (event: { device: LinkDevice }) => void
export interface LinkUsb {
  requestDevice(options: { filters: { vendorId: number }[] }): Promise<LinkDevice>
  getDevices(): Promise<LinkDevice[]>
  addEventListener(type: 'connect' | 'disconnect', listener: DeviceListener): void
  removeEventListener(type: 'connect' | 'disconnect', listener: DeviceListener): void
}
export type LinkSession = Pick<UploadSession, 'status' | 'connectionTrusted' | 'stage' | 'activate' | 'startTrial' | 'holdTrial' |
  'accept' | 'rollback' | 'cancel' | 'leaveUploadMode'>
type Connect = (transport: UsbVendorTransport, base: string) => Promise<LinkSession>

export type LinkStatus = 'unsupported' | 'idle' | 'connecting' | 'stock' | 'busy' | 'ready' | 'sending' | 'testing' | 'trial' | 'finishing'
export interface LinkState {
  readonly status: LinkStatus
  /** From IDENTIFY. `ready` without `canSubmit` is a base this page cannot send to. */
  readonly identity?: VendorIdentity
  /** HELLO's running set: the base's own digest while no module runs; null or absent when unknown. */
  readonly active?: string | null
  readonly module?: string
  /** 0–1 while sending. */
  readonly progress?: number
  /** The trial passed the stress test. */
  readonly tested?: boolean
  readonly notice?: { tone: 'success' | 'error'; text: string }
}

const REFUSED: Partial<Record<UploadResultName, string>> = {
  unsafe: 'Stop playback or finish recording on the Octatrack to continue.',
  identity: 'This module was built for a different Modwerk base.',
  limit: 'This module is too big for the Octatrack’s free memory.',
  length: 'This module is too big for the Octatrack’s free memory.',
  hash: 'The module arrived damaged. Nothing changed; send it again.',
  rejected: 'The Octatrack can’t run this module file.',
}
const UNPLUG = 'Unplug the USB cable to undo anything unfinished, then plug it back in.'

/** A stress test found a problem; its reason is shown to the user. */
export class StressTestFailure extends Error {}

/** What a failed step means for the user, in their words. */
export function explainLinkError(error: unknown): string {
  if (error instanceof StressTestFailure) return `The stress test failed: ${error.message}. Nothing was kept.`
  if (error instanceof DOMException && error.name === 'AbortError') return 'Cancelled. Nothing changed on the Octatrack.'
  if (error instanceof UploadDeviceError) return REFUSED[error.status.result] ?? 'The Octatrack refused this step.'
  if (error instanceof UploadUnconfirmedError) return 'The Octatrack stopped answering.'
  return 'Something went wrong talking to the Octatrack.'
}
const unsafe = (error: unknown) => error instanceof UploadDeviceError && error.status.result === 'unsafe'

export function webUsb(): LinkUsb | undefined {
  return typeof navigator !== 'undefined' && globalThis.isSecureContext ? (navigator as Navigator & { usb?: LinkUsb }).usb : undefined
}

export class OctatrackLink {
  private state: LinkState
  private readonly listeners = new Set<() => void>()
  private readonly usb?: LinkUsb | null
  private readonly connectSession: Connect
  private readonly stopWaitMs: number
  private device?: LinkDevice
  private index?: number
  private transport?: UsbVendorTransport
  private session?: LinkSession
  private abort?: AbortController
  private keepalive?: ReturnType<typeof setInterval>
  private users = 0

  /** `usb` defaults to the browser's WebUSB; null stands for a browser without it. */
  constructor(usb: LinkUsb | null | undefined = webUsb(), connectSession: Connect = (transport, base) => UploadSession.connect(transport, base), stopWaitMs = 3000) {
    this.usb = usb; this.connectSession = connectSession; this.stopWaitMs = stopWaitMs
    this.state = { status: usb ? 'idle' : 'unsupported' }
  }
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly getState = () => this.state
  private set(state: LinkState) { this.state = state; for (const listener of this.listeners) listener() }
  private ready(notice?: LinkState['notice'], active = this.state.active) { this.set({ status: 'ready', identity: this.state.identity, active, notice }) }

  /** Listen for the unit coming and going, and reopen one this site was allowed before, without the picker.
   * The card and the install dialog share one link: each view starts it and calls the returned release. */
  start() {
    if (this.users++ === 0 && this.usb) {
      this.usb.addEventListener('connect', this.onConnect)
      this.usb.addEventListener('disconnect', this.onDisconnect)
      void this.usb.getDevices().then(([device]) => { if (device && this.state.status === 'idle') return this.open(device) }).catch(() => {})
    }
    let stopped = false
    return () => { if (!stopped && (stopped = true) && --this.users === 0) this.stop() }
  }
  private stop() {
    this.usb?.removeEventListener('connect', this.onConnect)
    this.usb?.removeEventListener('disconnect', this.onDisconnect)
    this.stopKeepalive(); this.abort?.abort()
    void this.release(true)
  }
  /** Chrome's device picker; call from a click. */
  async connect() {
    let device: LinkDevice
    try { device = await this.usb!.requestDevice({ filters: [{ vendorId: ELEKTRON_VENDOR_ID }] }) } catch { return } // picker closed
    await this.open(device)
  }
  /** After another tab or app let go of the unit. */
  retry() { const device = this.device; return device ? this.open(device) : this.connect() }
  // An Octatrack restarting after its OS upgrade comes back here, so the install guide's last step completes by itself.
  private readonly onConnect: DeviceListener = ({ device }) => {
    if (['idle', 'stock', 'busy'].includes(this.state.status)) void this.open(device)
  }
  private readonly onDisconnect: DeviceListener = ({ device }) => {
    if (device !== this.device) return
    const { status, module } = this.state
    this.stopKeepalive(); this.abort?.abort()
    this.device = this.index = this.transport = this.session = undefined
    this.set({ status: 'idle', notice: status === 'sending' ? { tone: 'error', text: 'USB disconnected. Nothing changed on the Octatrack.' }
      : status === 'testing' || status === 'trial' || status === 'finishing' ? { tone: 'error', text: `USB disconnected. The Octatrack undoes ${module} by itself as soon as playback is stopped.` }
      : undefined })
  }

  private async open(device: LinkDevice) {
    await this.release(true)
    this.set({ status: 'connecting' })
    this.device = device
    try {
      if (!device.opened) await device.open()
      if (!device.configuration) await device.selectConfiguration(1)
      const index = findVendorInterface(device.configuration)
      if (index === undefined) { await device.close().catch(() => {}); return this.set({ status: 'stock' }) }
      this.index = index; this.transport = new UsbVendorTransport(device, index)
      if (!await this.claim()) return
      try {
        const identity = await this.transport.identify()
        // HELLO is read-only; a base that cannot answer it still counts as ready.
        const active = identity.canSubmit ? await this.connectSession(this.transport, identity.base).then(s => s.status.active, () => undefined) : undefined
        this.set({ status: 'ready', identity, active })
      }
      catch { this.set({ status: 'ready', identity: undefined }) } // a Modwerk base this page does not speak
      finally { await this.release() }
    } catch (error) {
      console.error(error)
      this.device = undefined
      this.set({ status: 'idle', notice: { tone: 'error', text: 'Chrome couldn’t open the Octatrack. Unplug it, plug it back in and try again.' } })
    }
  }
  /** Claimed only while talking, so other tabs and `npm run device` can use the unit in between. */
  private async claim() {
    try { await this.device!.claimInterface(this.index!); return true } catch {
      this.set({ status: 'busy', identity: this.state.identity })
      return false
    }
  }
  private async release(close = false) {
    const device = this.device, index = this.index
    if (device?.opened && index !== undefined) await device.releaseInterface(index).catch(() => {})
    if (close) { this.device = this.index = this.transport = this.session = undefined; if (device?.opened) await device.close().catch(() => {}) }
  }

  /** Load an update (the configuration as one runtime package) and start its trial. With `stressTest`, the
   * unit is tested first (null means passed) and a failure undoes the update. The previous modules stay
   * until the user keeps it. */
  async update(module: string, data: Uint8Array, stressTest?: () => Promise<string | null>) {
    const base = this.state.identity?.base
    if (this.state.status !== 'ready' || !this.state.identity?.canSubmit || !base || !await this.claim()) return
    const abort = this.abort = new AbortController()
    this.set({ status: 'sending', identity: this.state.identity, active: this.state.active, module, progress: 0 })
    let session: LinkSession | undefined
    try {
      session = this.session = await this.connectSession(this.transport!, base)
      if (data.length > session.status.capacity) throw new UploadDeviceError({ ...session.status, result: 'limit' })
      // shortcut: module files do not name their base yet (as in scripts/device.mjs), so the connected base's loader
      // validates the file; bind the package to its base once module files carry one.
      await this.whenStopped(() => session!.stage({ base, data, sha256: sha(data) }, { signal: abort.signal,
        progress: (received, length) => this.set({ ...this.state, progress: received / length }) }))
      await session.activate()
      await session.startTrial()
      this.startKeepalive()
      if (stressTest) {
        this.set({ status: 'testing', identity: this.state.identity, active: session.status.active, module })
        const failure = await stressTest()
        if (failure) throw new StressTestFailure(failure)
      }
      this.set({ status: 'trial', identity: this.state.identity, active: session.status.active, module, tested: !!stressTest })
    } catch (error) {
      await this.failed(error, session)
    }
  }
  cancel() { this.abort?.abort() }
  keep() { return this.finish(true) }
  undo() { return this.finish(false) }

  private async finish(keep: boolean) {
    const session = this.session, module = this.state.module
    if (this.state.status !== 'trial' || !session) return
    this.stopKeepalive()
    this.set({ ...this.state, status: 'finishing', notice: undefined })
    try {
      await this.whenStopped(() => session.holdTrial())
      if (keep) await session.accept(); else await session.rollback()
      await session.leaveUploadMode()
      await this.release()
      this.ready({ tone: 'success', text: keep ? `Kept. ${module} stays on your Octatrack, also after a restart.` : 'Undone. Your Octatrack is back to how it was.' },
        session.status.active)
    } catch (error) {
      // Playing blocks the stop that keep and undo need; the trial carries on until the user stops.
      if (unsafe(error) && session.connectionTrusted && session.status.phase === 'trial') {
        this.startKeepalive()
        return this.set({ ...this.state, status: 'trial', notice: { tone: 'error', text: explainLinkError(error) } })
      }
      await this.failed(error, session)
    }
  }

  /** Undo what this session left behind if the connection is still trusted; otherwise the unplug advice. */
  private async failed(error: unknown, session?: LinkSession) {
    if (!(error instanceof UploadDeviceError) && !(error instanceof DOMException) && !(error instanceof StressTestFailure)) console.error(error)
    this.stopKeepalive()
    let clean = !session
    if (session?.connectionTrusted) {
      try {
        const phase = session.status.phase
        if (phase === 'receiving' || phase === 'verified') await session.cancel()
        else if (phase === 'pending' || phase === 'trial' || phase === 'recovery') { await session.rollback(); await session.leaveUploadMode() }
        else if (phase === 'ready') await session.leaveUploadMode()
        clean = session.status.phase === 'normal'
      } catch { clean = false }
    }
    this.session = undefined
    await this.release()
    // An untrusted connection leaves the running set unknown.
    if (this.device) this.ready({ tone: 'error', text: explainLinkError(error) + (clean ? '' : ' ' + UNPLUG) },
      session ? (session.connectionTrusted ? session.status.active : undefined) : this.state.active)
  }
  /** Repeat a step the base refused only because the unit plays or records, for `stopWaitMs`. */
  private async whenStopped<T>(step: () => Promise<T>): Promise<T> {
    for (const start = Date.now(); ; await wait(STOP_RETRY_MS)) {
      try { return await step() } catch (error) { if (!unsafe(error) || Date.now() - start >= this.stopWaitMs) throw error }
    }
  }
  private startKeepalive() {
    this.stopKeepalive()
    this.keepalive = setInterval(() => { void this.transport?.identify().catch(() => {}) }, KEEPALIVE_MS)
  }
  private stopKeepalive() { clearInterval(this.keepalive); this.keepalive = undefined }
}
