import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModuleDetail } from '../components/ModuleDetail'
import { AVAILABLE_MODULES } from '../catalog/availability'
import { CommunityContext, emptySession } from '../community/context'
import type { Session } from '../community/api'
import { DigiModDetail } from './DigiModDetail'
import { DIGI_MODS, digiModuleDocument } from './digi-mods'
import { DEVICES_BY_ID } from './registry'

const noop = () => {}
const member: Session = { available: true, admin: false, user: { id: 'member', displayName: 'Member', username: 'member', verified: true } }
function render(page: ReactNode, session = emptySession) {
  return renderToStaticMarkup(createElement(CommunityContext.Provider, { value: { session, developer: null, catalog: [], refresh: async () => {}, refreshDeveloper: async () => {} } }, page))
}
function digiPage(mod: typeof DIGI_MODS[number], selected = false) {
  return createElement(DigiModDetail, { device: { ...DEVICES_BY_ID[mod.device], id: mod.device }, mod, selected, onToggle: noop })
}

describe('module detail parity across machines', () => {
  it('uses the OT page structure for every Digi module, with community actions and the complete guide', () => {
    const ot = render(createElement(ModuleDetail, { module: AVAILABLE_MODULES[0], selected: false, onToggle: noop }))
    for (const mod of DIGI_MODS) {
      const html = render(digiPage(mod))
      for (const markup of [
        'class="module-page-actions"', 'class="button button-quiet module-issue-action"', 'Works for me', 'class="detail-works-summary"', 'Across versions',
        'class="detail-hero detail-hero-with-resources"', 'class="module-resource-summary"',
        'Reviews &amp; discussion', 'role="tablist" aria-label="Module information"',
        'id="tab-Overview" aria-selected="true"', 'id="tab-Media" aria-selected="false"',
        'id="tab-Discussion" aria-selected="false"', 'id="tab-Changelog" aria-selected="false"', 'id="tab-Issues" aria-selected="false"', 'role="tabpanel" aria-labelledby="tab-Overview"',
        'class="module-showcase"', 'Screenshots &amp; audio', 'class="ratings-overview"',
        'Rate &amp; discuss', 'class="module-guide"', 'About &amp; credits',
        'Controls &amp; defaults', 'How to use it', 'Technical details &amp; safety', 'class="issue-report"',
      ]) {
        expect(ot).toContain(markup)
        expect(html, mod.device + '/' + mod.id).toContain(markup)
      }
      expect(html).toContain('aria-label="Like ' + mod.device + '-' + mod.id + '"')
      expect(html).toContain('href="#' + mod.device + '"')
      expect(html).toContain('aria-selected="true"')
      expect(html).not.toContain('comments-section')
      expect(html).toContain('Sign in')
    }
  })

  it('shows each module’s complete documentation and declared defaults without borrowing OT content', () => {
    for (const mod of DIGI_MODS) {
      const document = digiModuleDocument(mod), html = render(digiPage(mod, true))
      expect(html).toContain(renderToStaticMarkup(createElement('p', null, document.presentation.overview)))
      expect(html).toContain('Find it on your ' + DEVICES_BY_ID[mod.device].name)
      expect(html).toContain(document.version)
      expect(html).toContain('/sdk/' + mod.device + '/modules/' + mod.id + '/' + document.tests.report)
      for (const control of document.controls) expect(html).toContain(control.doc.replaceAll('&', '&amp;'))
      expect(html).toContain('Added to module set')
      expect(html).not.toContain('Find it on your Octatrack')
      expect(html).not.toContain('adjust on your Octatrack')
    }
  })

  it('credits DigiSophie’s developer separately from its original algorithm author', () => {
    const mod = DIGI_MODS.find(mod => mod.device === 'digitakt' && mod.id === 'digisophie')!
    const html = render(digiPage(mod))
    expect(html).toContain('by Sjoerd (Soejrd)')
    expect(html).toContain('href="https://github.com/soejrd/digisophie"')
    expect(html).toContain('Matt Estela (@mestela) — original Sophie for Schwung algorithm')
    expect(html).toContain('For @soejrd')
    expect(html).not.toContain('>by Matt Estela')
    expect(html).not.toContain('For @mestela')
  })

  it('keeps missing processor measurements distinct from zero load', () => {
    const html = render(digiPage(DIGI_MODS[0]))
    for (const label of ['CPU', 'DSP core']) {
      expect(html).toContain('role="img" aria-label="' + label + ' relative load: Not measured"')
    }
    expect(html).toContain('CPU and DSP load have no separate measurements yet.')
    expect(html).toContain('role="meter" aria-label="Memory relative load"')
    expect(html).not.toContain('aria-valuenow="0"')
  })

  it('offers the report form on both Digi machines with public delivery, private configuration, and machine-specific fields', () => {
    for (const machine of ['digitakt', 'digitone'] as const) {
      const mod = DIGI_MODS.find(mod => mod.device === machine && mod.id === 'digihealth')!
      const html = render(digiPage(mod), member)
      for (const name of ['title', 'model', 'flash', 'os', 'moduleVersion', 'steps', 'expected', 'actual']) {
        expect(html).toContain('name="' + name + '"')
      }
      expect(html).toContain('What happened?')
      expect(html).toContain('Steps to reproduce <span>Optional')
      expect(html).toContain('Post report')
      expect(html).toContain('href="#forum?category=issues"')
      expect(html).toContain('configuration, build fingerprint and any attached log stay private')
      const version = digiModuleDocument(mod).version
      expect(html).toContain('name="moduleVersion" value="' + version + '"')
      const osOptions = html.match(/<select name="os"[^>]*>([\s\S]*?)<\/select>/)![1]
      for (const release of DEVICES_BY_ID[machine].firmware!.releases) expect(osOptions).toContain('>' + release + '</option>')
      expect(osOptions).not.toContain(machine === 'digitakt' ? '>1.44</option>' : '>1.53</option>')
      expect(html).not.toContain('type="file"')
      expect(html).not.toContain('3. Attach the device log')
    }
  })
})
