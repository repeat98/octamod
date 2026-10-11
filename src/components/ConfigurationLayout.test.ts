import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { newConfiguration } from '../config/workspace'
import { FIRMWARE_SHARING_NOTICE, FLASHING_RISKS } from '../firmware-notices'
import { ConfigurationHeader, RiskAcceptance } from './ConfigurationLayout'

const header = { kicker: 'YOUR WORKSPACE', meta: 'Octatrack', configurations: [], onSelect: vi.fn(), onDialog: vi.fn(), onImport: vi.fn(), shareHref: '#forum', canReport: true, onReport: vi.fn() }

describe('configuration page layout', () => {
  it('makes the name the switcher and keeps the other actions behind one menu button', () => {
    const first = newConfiguration('Live set'), second = newConfiguration('Studio')
    const html = renderToStaticMarkup(createElement(ConfigurationHeader, { ...header, configuration: second, configurations: [first, second] }))
    expect(html).toMatch(/<h1><select class="configuration-switcher" aria-label="Choose module set">/)
    expect(html).toContain('<option value="' + second.id + '" selected="">Studio</option>')
    expect(html).toContain('aria-label="Module set actions"')
    expect(html).not.toContain('Delete')
  })

  it('shows only New and the empty title without a configuration', () => {
    const html = renderToStaticMarkup(createElement(ConfigurationHeader, { ...header, emptyTitle: 'No Digitakt configuration yet' }))
    expect(html).toContain('<h1>No Digitakt configuration yet</h1>')
    expect(html).toContain('New')
    expect(html).not.toContain('Module set actions')
  })

  it('keeps the full flashing and sharing notices beside the acknowledgement', () => {
    const html = renderToStaticMarkup(createElement(RiskAcceptance, { checked: false, onChange: vi.fn() }))
    expect(html).toContain(FLASHING_RISKS)
    expect(html).toContain(FIRMWARE_SHARING_NOTICE)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('I understand the risks of flashing custom firmware.')
  })
})
