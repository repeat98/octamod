import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MODULES } from '../catalog/modules'
import { CommunityContext, emptySession } from '../community/context'
import { USB_AUDIO_MODULE, usbAudioPreset } from '../config/usb-audio'
import { ModuleCard } from './ModuleCard'
import { ModuleDetail } from './ModuleDetail'
import { ModuleComparison } from './ModuleComparison'
import { UsbAudioConfigurator } from './UsbAudioConfigurator'

const noop = () => {}
const usb = MODULES.find(module => module.id === USB_AUDIO_MODULE)!
function render(page: ReactNode) {
  return renderToStaticMarkup(createElement(CommunityContext.Provider, { value: { session: emptySession, developer: null, catalog: [], refresh: async () => {}, refreshDeveloper: async () => {} } }, page))
}
function card(module = usb, selected = false) {
  return render(createElement(ModuleCard, { module, selected, baseline: null, compared: false, canCompare: true, onToggle: noop, onCompare: noop }))
}

describe('USB Audio setup before adding', () => {
  it('offers configuration instead of quick-add from the library and comparison', () => {
    expect(card()).toContain('aria-label="Configure USB Audio"')
    expect(card()).not.toContain('aria-label="Add USB Audio to module set"')
    const comparison = render(createElement(ModuleComparison, { ids: [USB_AUDIO_MODULE], selected: [], digiSelected: { digitakt: [], digitone: [] }, onToggle: noop, onToggleDigi: noop, onClose: noop }))
    expect(comparison).toContain('>Configure USB Audio</button>')
    expect(comparison).not.toContain('>Add USB Audio</button>')
  })
  it('puts the add action inside the setup, while the hero opens configuration', () => {
    const html = render(createElement(ModuleDetail, { module: usb, selected: false, onToggle: noop, onConfigureUsbAudio: noop }))
    const [hero, setup] = html.split('id="usb-setup"')
    expect(hero).toContain('Configure USB Audio</button>')
    expect(hero).not.toContain('Add to module set</button>')
    expect(setup).toContain('Add to module set</button>')
  })
  it('retains removal for selected USB and quick-add for other modules', () => {
    expect(card(usb, true)).toContain('aria-label="Remove USB Audio from module set"')
    const other = MODULES.find(module => module.id === 'miniverb')!
    expect(card(other)).toContain('aria-label="Add Mini Verb to module set"')
  })
  it('shows the saved state only after settings have been added', () => {
    const configuration = { ...usbAudioPreset('outbox'), outboxPairs: [1, 3, 5, 7] }
    const html = render(createElement(UsbAudioConfigurator, { draft: configuration, configuration, selected: true, onConfigure: noop, onDraftChange: noop }))
    expect(html).toContain('disabled=""')
    expect(html).toContain('Setup saved</button>')
    expect(html).not.toContain('Add to module set</button>')
  })
  it('does not offer the legacy stack as an Outbox setup', () => {
    const html = render(createElement(UsbAudioConfigurator, { draft: usbAudioPreset('outbox'), selected: false, onConfigure: noop, onDraftChange: noop }))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Use classic 20-channel setup<\/button>/)
  })
  it('identifies physical outputs and their USB sources without duplicating the channel map', () => {
    const html = render(createElement(UsbAudioConfigurator, { draft: { ...usbAudioPreset('outbox'), outboxPairs: [1, 3, 0, 8] }, selected: false, onConfigure: noop, onDraftChange: noop }))
    expect(html).toContain('for="usb-outbox-1">Outbox 3/4')
    expect(html).toContain('aria-describedby="usb-outbox-source-1"')
    expect(html).toContain('From USB 5/6')
    expect(html).toContain('No audio sent')
    expect(html).not.toContain('USB input channel map')
    expect(html).toContain('Modwerk saves the plan; the app applies it to your Outbox.')
  })
  it('shows recording inputs for a computer instead of physical output controls', () => {
    const html = render(createElement(UsbAudioConfigurator, { draft: usbAudioPreset('computer'), selected: false, onConfigure: noop, onDraftChange: noop }))
    expect(html).toContain('USB inputs in your DAW')
    expect(html).toContain('USB 19/20')
    expect(html).not.toContain('id="usb-outbox-0"')
    expect(html).toContain('Estimated CPU load')
    expect(html).toContain('3,438')
    expect(html).toContain('not the Octatrack’s total CPU percentage')
  })
  it('distinguishes unsaved changes from the saved setup and offers a reset', () => {
    const configuration = usbAudioPreset('outbox')
    const draft = { ...configuration, outboxPairs: [1, 3, 5, 7] }
    const html = render(createElement(UsbAudioConfigurator, { draft, configuration, selected: true, configurationName: 'Live set', onConfigure: noop, onDraftChange: noop }))
    expect(html).toContain('Unsaved changes for')
    expect(html).toContain('Live set')
    expect(html).toContain('Discard changes</button>')
    expect(html).toContain('Save setup</button>')
    expect(html).not.toContain('Setup saved</button>')
  })
  it('explains the silence when all physical outputs are switched off', () => {
    const html = render(createElement(UsbAudioConfigurator, { draft: { ...usbAudioPreset('outbox'), outboxPairs: [0, 0, 0, 0] }, selected: false, onConfigure: noop, onDraftChange: noop }))
    expect(html).toContain('All Outbox outputs are off. Assign a signal to hear audio.')
  })
})
