import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha } from '../../../vendor/elekloader/kit/src/bytes.ts'
import { FAKE_BASE, fakeSession, fakeUnit } from '../../dev/octatrack-link-fake'
import { OctatrackLink } from './octatrack-link'

const settle = () => new Promise(resolve => setTimeout(resolve, 0))
async function linked(kind: 'base' | 'stock' | 'none' = 'base') {
  const unit = fakeUnit(kind), link = new OctatrackLink(unit.usb, fakeSession(unit), 300)
  link.start(); await settle(); await settle()
  return { unit, link }
}
afterEach(() => { vi.useRealTimers() })

describe('finding the unit', () => {
  it('reports a browser without WebUSB instead of offering a dead button', () => {
    expect(new OctatrackLink(undefined).getState().status).toBe('unsupported')
  })
  it('reopens an allowed unit and reads its base without the picker', async () => {
    const { link } = await linked()
    expect(link.getState()).toMatchObject({ status: 'ready', identity: { base: FAKE_BASE, model: 'OCTATRACK MKII', canSubmit: true }, active: FAKE_BASE })
  })
  it('tells a stock unit apart, then finds the base when the unit restarts after its OS upgrade', async () => {
    const { unit, link } = await linked('stock')
    expect(link.getState().status).toBe('stock')
    unit.unplug(); expect(link.getState().status).toBe('idle')
    unit.plug('base'); await settle(); await settle()
    expect(link.getState().status).toBe('ready')
  })
  it('says when another tab or app holds the unit, and retries', async () => {
    const unit = fakeUnit(), link = new OctatrackLink(unit.usb, fakeSession(unit))
    unit.taken = true; link.start(); await settle(); await settle()
    expect(link.getState().status).toBe('busy')
    unit.taken = false; await link.retry()
    expect(link.getState().status).toBe('ready')
  })
  it('stays connected while any view still uses it', async () => {
    const unit = fakeUnit(), link = new OctatrackLink(unit.usb, fakeSession(unit))
    const card = link.start(), dialog = link.start(); await settle(); await settle()
    card(); card()
    expect(link.getState().status).toBe('ready')
    unit.unplug(); expect(link.getState().status).toBe('idle') // still listening
    dialog(); unit.plug('base'); await settle(); await settle()
    expect(link.getState().status).toBe('idle') // nobody listens any more
  })
})

describe('sending a module', () => {
  const data = new Uint8Array(10000)
  it('runs a trial, then keeps it', async () => {
    const { link } = await linked()
    const progress: number[] = []
    link.subscribe(() => { if (link.getState().status === 'sending') progress.push(link.getState().progress!) })
    await link.update('PREVIEW VOL', data)
    expect(link.getState()).toMatchObject({ status: 'trial', module: 'PREVIEW VOL', active: sha(data) })
    expect(progress.at(-1)).toBe(1)
    await link.keep()
    expect(link.getState()).toMatchObject({ status: 'ready', notice: { tone: 'success' }, active: sha(data) })
    expect(link.getState().notice!.text).toMatch(/Kept\. PREVIEW VOL stays on your Octatrack, also after a restart/)
  })
  it('keeps the trial running when playback blocks keep, and finishes once stopped', async () => {
    const { unit, link } = await linked()
    await link.update('PREVIEW VOL', data)
    unit.playing = true; await link.undo()
    expect(link.getState()).toMatchObject({ status: 'trial', notice: { tone: 'error', text: expect.stringMatching(/Stop playback/) } })
    unit.playing = false; await link.undo()
    expect(link.getState()).toMatchObject({ active: FAKE_BASE, notice: { text: expect.stringMatching(/^Undone/) } })
  })
  it('goes ahead as soon as playback stops within the wait', async () => {
    const { unit, link } = await linked()
    unit.playing = true; setTimeout(() => { unit.playing = false }, 100) // the base pressing STOP, or the user
    await link.update('PREVIEW VOL', data)
    expect(link.getState().status).toBe('trial')
  })
  it('refuses to start while playing, without asking the user to unplug', async () => {
    const { unit, link } = await linked()
    unit.playing = true; await link.update('PREVIEW VOL', data)
    expect(link.getState()).toMatchObject({ status: 'ready', notice: { tone: 'error', text: 'Stop playback or finish recording on the Octatrack to continue.' } })
  })
  it('stress-tests an update before it can be kept, and undoes it when the test fails', async () => {
    const { link } = await linked(), seen: string[] = []
    link.subscribe(() => { seen.push(link.getState().status) })
    await link.update('My set', data, async () => null)
    expect(seen).toContain('testing')
    expect(link.getState()).toMatchObject({ status: 'trial', tested: true })
    await link.keep()
    await link.update('My set', data, async () => 'CPU over budget on track 3')
    expect(link.getState()).toMatchObject({ status: 'ready', notice: { tone: 'error', text: 'The stress test failed: CPU over budget on track 3. Nothing was kept.' } })
  })
  it('refuses a module bigger than the base can stage', async () => {
    const { link } = await linked()
    await link.update('HUGE', new Uint8Array(262145))
    expect(link.getState().notice?.text).toMatch(/too big/)
  })
  it('cancels a transfer cleanly', async () => {
    const { link } = await linked()
    link.subscribe(() => { if (link.getState().progress) link.cancel() }) // the button shows once sending has started
    await link.update('PREVIEW VOL', data)
    expect(link.getState().notice?.text).toBe('Cancelled. Nothing changed on the Octatrack.')
  })
  it('keeps the trial alive with a request every second, and explains an unplug mid-trial', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { unit, link } = await linked()
    await link.update('PREVIEW VOL', data)
    const device = (await unit.usb.getDevices())[0], identify = vi.spyOn(device, 'controlTransferIn')
    vi.advanceTimersByTime(3000)
    expect(identify).toHaveBeenCalledTimes(3)
    unit.unplug()
    expect(link.getState()).toMatchObject({ status: 'idle', notice: { text: expect.stringMatching(/undoes PREVIEW VOL by itself/) } })
    vi.advanceTimersByTime(3000)
    expect(identify).toHaveBeenCalledTimes(3)
  })
})
