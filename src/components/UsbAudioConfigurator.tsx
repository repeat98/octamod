import { useEffect, useRef, useState } from 'react'
import { USB_AUDIO_LAYOUTS, changeUsbAudioLayout, suggestedUsbAudioPairs, usbAudioLayout, type UsbAudioConfiguration, type UsbAudioLayout } from '../config/usb-audio'
import { Icon } from './Icon'
import { usbAudioCpuLoad } from '../config/usb-audio-load'
import './usb-audio.css'

const audioChoices: Record<UsbAudioLayout, { label: string; description: string }> = {
  'main-cue': { label: 'Main + Cue mixes', description: 'Your final stereo Main mix plus a separate stereo Cue mix.' },
  main: { label: 'Main mix', description: 'Your final stereo Main mix, ready to record or send to speakers.' },
  'tracks-post': { label: '8 tracks · follow track levels', description: 'Separate stereo tracks that follow LEVEL, mutes, solo and the crossfader. MAIN LEVEL and master effects on tracks 1–7 are excluded.' },
  tracks: { label: '8 tracks · before track levels', description: 'Separate stereo tracks taken before LEVEL, so you can mix them independently.' },
  'tracks-main-cue': { label: '8 tracks + Main + Cue', description: 'Eight separate stereo tracks before LEVEL, plus your final Main and Cue mixes.' },
  master: { label: 'Track 8 / Master', description: 'Track 8 after its effects, before LEVEL. Enable MASTER TRACK on the Octatrack to use this as a master mix.' },
}
const audioGroups: { label: string; layouts: UsbAudioLayout[] }[] = [
  { label: 'Main & Cue mixes', layouts: ['main-cue', 'main'] },
  { label: 'Individual tracks', layouts: ['tracks-post', 'tracks', 'tracks-main-cue', 'master'] },
]

export function UsbAudioConfigurator({ draft, onDraftChange, configuration, selected, configurationName, onConfigure }: {
  draft: UsbAudioConfiguration; onDraftChange: (configuration: UsbAudioConfiguration) => void
  configuration?: UsbAudioConfiguration; selected: boolean; configurationName?: string
  onConfigure: (configuration: UsbAudioConfiguration | undefined) => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [routingNotice, setRoutingNotice] = useState('')
  const setupRef = useRef<HTMLElement>(null)
  const layout = usbAudioLayout(draft.layout), outbox = draft.destination === 'outbox'
  const cpu = usbAudioCpuLoad(draft.layout)
  const saved = selected && JSON.stringify(draft) === JSON.stringify(configuration)
  const dirty = selected && !!configuration && !saved

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('setup') !== '1') return
    const frame = requestAnimationFrame(() => {
      setupRef.current?.scrollIntoView({ block: 'start' })
      setupRef.current?.focus({ preventScroll: true })
      const url = new URL(window.location.href)
      url.searchParams.delete('setup')
      window.history.replaceState(window.history.state, '', url)
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  function updateDraft(next: UsbAudioConfiguration) {
    onDraftChange(next)
    setCopied(false)
    setCopyError('')
  }
  function chooseLayout(id: UsbAudioLayout) {
    const next = changeUsbAudioLayout(draft, id)
    const cleared = draft.outboxPairs.flatMap((pair, index) => pair && !next.outboxPairs[index] ? [index * 2 + 1 + '/' + (index * 2 + 2)] : [])
    setRoutingNotice(cleared.length ? 'Outbox ' + cleared.join(', ') + ' now off. Their previous signals are unavailable in this audio source.' : '')
    updateDraft(next)
  }
  async function copyRouting() {
    const routes = draft.outboxPairs.map((pair, index) => 'Outbox ' + (index * 2 + 1) + '/' + (index * 2 + 2) + ': ' + (pair ? layout.pairs[pair - 1] + ' / USB ' + (pair * 2 - 1) + '/' + (pair * 2) : 'Off'))
    try {
      await navigator.clipboard.writeText([layout.name, '44.1 kHz / 24-bit', ...routes, 'Apply in https://app.elektron.se/outbox8'].join('\n'))
      setCopied(true)
      setCopyError('')
    } catch { setCopyError('Copy is unavailable. Use the assignments shown here.') }
  }

  return <section id="usb-setup" ref={setupRef} className="usb-setup" aria-labelledby="usb-setup-title" tabIndex={-1}>
    <div className="usb-setup-heading"><h2 id="usb-setup-title">USB Audio setup</h2><span className="subtle">44.1 kHz · 24-bit</span></div>
    <div className="usb-setup-fields">
      <fieldset className="usb-setup-destination"><legend>Send audio to</legend><div className="usb-setup-destination-options">
        {(['computer', 'outbox'] as const).map(destination => <label key={destination} className={draft.destination === destination ? 'is-active' : ''}>
          <input type="radio" name="usb-destination" value={destination} checked={draft.destination === destination} onChange={() => updateDraft({ ...draft, destination })}/>
          {destination === 'outbox' ? 'Outbox 8' : 'Computer'}
        </label>)}
      </div></fieldset>
      <div className="usb-setup-feed"><label htmlFor="usb-audio-source">Audio to send</label>
        <select id="usb-audio-source" aria-describedby="usb-audio-description" value={draft.layout} onChange={event => chooseLayout(event.target.value as UsbAudioLayout)}>
          {audioGroups.map(group => <optgroup key={group.label} label={group.label}>{group.layouts.map(id => {
            const item = USB_AUDIO_LAYOUTS.find(item => item.id === id)!
            return <option key={id} value={id}>{audioChoices[id].label} · {item.channels} channels</option>
          })}</optgroup>)}
        </select>
      </div>
    </div>
    <p id="usb-audio-description" className="usb-setup-description">{audioChoices[draft.layout].description}</p>
    <details className="usb-setup-cpu"><summary>Estimated CPU load <strong>{cpu.level}</strong><Icon name="help" size={13}/></summary>
      <p>{cpu.rationale} These estimates compare USB configurations; they are not the Octatrack’s total CPU percentage. <a href={cpu.source} target="_blank" rel="noreferrer">Load source ↗</a></p>
    </details>
    {outbox ? <div className="usb-setup-outbox">
      <div className="usb-setup-routing-heading"><div><h3>Outbox outputs</h3><p>Four stereo pairs · 8 physical outputs</p></div>
        <button className="text-button" onClick={() => { updateDraft({ ...draft, outboxPairs: suggestedUsbAudioPairs(draft.layout) }); setRoutingNotice('Available signals assigned in order. Remaining outputs are off.') }}>Assign in order</button>
      </div>
      <div className="usb-setup-output-grid">{draft.outboxPairs.map((pair, index) => <div className="usb-setup-output" key={index}>
        <label htmlFor={'usb-outbox-' + index}>Outbox {index * 2 + 1}/{index * 2 + 2}</label>
        <select id={'usb-outbox-' + index} aria-describedby={'usb-outbox-source-' + index} value={pair} onChange={event => {
          const pairs = [...draft.outboxPairs]; pairs[index] = Number(event.target.value)
          updateDraft({ ...draft, outboxPairs: pairs }); setRoutingNotice('')
        }}><option value={0}>Off</option>{layout.pairs.map((source, i) => <option key={source} value={i + 1}>{source}</option>)}</select>
        <span id={'usb-outbox-source-' + index} className={'usb-setup-usb-pair' + (pair ? '' : ' is-off')}>{pair ? 'From USB ' + (pair * 2 - 1) + '/' + (pair * 2) : 'No audio sent'}</span>
      </div>)}</div>
      {routingNotice && <p className="usb-setup-notice" role="status">{routingNotice}</p>}
      {draft.outboxPairs.every(pair => pair === 0) && <p className="usb-setup-notice">All Outbox outputs are off. Assign a signal to hear audio.</p>}
      <div className="usb-setup-routing"><p>Match these USB pairs in <a href="https://app.elektron.se/outbox8" target="_blank" rel="noreferrer">Elektron’s Outbox app ↗</a>. Modwerk saves the plan; the app applies it to your Outbox.</p>
        <button className="text-button" onClick={() => { void copyRouting() }}>{copied ? 'Assignments copied' : 'Copy assignments'}</button>
      </div>
      <span className="sr-only" role="status">{copied ? 'Outbox assignments copied to clipboard.' : ''}</span>
      {copyError && <p className="usb-setup-notice" role="alert">{copyError}</p>}
    </div> : <div className="usb-setup-computer"><h3>USB inputs in your DAW</h3><p>Choose these stereo input pairs when recording.</p>
      <div className="usb-setup-channels" aria-label="USB input channel map">{layout.pairs.map((pair, index) => <span key={pair}>{pair}<small>USB {index * 2 + 1}/{index * 2 + 2}</small></span>)}</div>
    </div>}
    <div className="usb-setup-footer"><div className="usb-setup-save-target"><span>{dirty ? 'Unsaved changes for' : saved ? 'Saved to module set' : 'Module set'}</span><strong>{configurationName ?? 'Your module set'}</strong></div>
      <div className="usb-setup-save-actions">{dirty && <button className="text-button" onClick={() => { if (configuration) updateDraft(configuration); setRoutingNotice('') }}>Discard changes</button>}
        <button className={'button ' + (saved ? 'button-added' : 'button-primary')} disabled={saved} onClick={() => onConfigure(draft)}><Icon name={saved ? 'check' : selected ? 'sliders' : 'plus'} size={15}/>{saved ? 'Setup saved' : selected ? 'Save setup' : 'Add to module set'}</button>
      </div>
    </div>
    <p className="usb-setup-status">USB 0.2 experimental · Released with owner approval; hardware testing was waived.</p>
    <details className="usb-setup-details"><summary>Compatibility & classic setup</summary><p>Full channel counts need high-speed USB. At full speed, track layouts use a stereo sum and Main + Cue uses Main. The updated stack adds the Outbox 44.1 kHz handshake and stream reset fixes.</p>{draft.layout === 'tracks-post' && <p>With a master track, tracks 1–7 lead track 8 by 32 samples.</p>}<p>The classic setup has eight pre-LEVEL track pairs, Main and Cue. It retains the existing USB implementation and has no Outbox rate handshake. Choose Computer to use it.</p><button className="button button-quiet" disabled={outbox || (selected && !configuration)} onClick={() => onConfigure(undefined)}>{selected && !configuration ? 'Classic setup selected' : 'Use classic 20-channel setup'}</button></details>
  </section>
}
