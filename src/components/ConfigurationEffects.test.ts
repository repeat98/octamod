import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import metadata from '../engine/assets/chooser-metadata.json'
import type { BuildReport } from '../engine/protocol'
import type { BuildView } from '../hooks/useFirmwareBuild'
import { ConfigurationEffects } from './ConfigurationEffects'

function render(ids: string[], build: BuildView = { key: 'selection', state: 'empty' }, keepStockFx2 = true) {
  return renderToStaticMarkup(createElement(ConfigurationEffects, { ids, build, keepStockFx2 }))
}

describe('configuration stock FX summary', () => {
  it('names the replaced effect before a firmware file is selected', () => {
    const html = render(['tapeecho'])
    expect(html).toContain('Selection preview')
    expect(html).toContain('<li>Spring Reverb</li>')
    expect(html).not.toContain('<li>Plate Reverb</li>')
    expect(html).not.toContain('<li>Dark Reverb</li>')
    expect(html).toContain('All original FX1 effects remain available.')
    expect(html).toContain('final FX menus are confirmed after your base firmware is checked')
  })

  it('uses the entire selection and the engine’s effective stock setting', () => {
    const html = render(['miniverb', 'tapeecho', 'euclid'], undefined, false)
    expect(html).toContain('<li>Dark Reverb</li>')
    expect(html).not.toContain('<li>Spring Reverb</li>')
    expect(html).not.toContain('<li>Filter</li>')
    expect(render(['analog-bassdrum'])).toContain('<li>Spring Reverb</li>')
  })

  it('shows that empty and non-DSP selections preserve all stock effects', () => {
    for (const ids of [[], ['repitch', 'midi-scenes', 'usb-audio-out-tracks-main-cue', 'quantizer']]) {
      const html = render(ids)
      expect(html).toContain('No stock FX will be replaced.')
      expect(html).toContain('All original FX1 and FX2 effects remain available.')
      expect(html).not.toContain('<li>')
    }
  })

  it('uses the checked build report, including every omission from a compact menu', () => {
    const report: BuildReport = {
      version: 'OCTAMOD79', revision: 'test', sourceCommit: null, sourceTreeSha256: 'test',
      moduleIds: ['tapeecho'], moduleVersions: { tapeecho: '1.0.0' }, keepStockFx2: false,
      osBytes: 0, runtimeBytes: 0, reservedBytes: 0, fx1Rows: 10, fx2Rows: 1, omittedStockFx2: metadata.stockFx2,
    }
    const html = render(['tapeecho'], { key: 'selection', state: 'valid', report })
    expect(html).toContain('Checked for this build')
    expect(html.match(/<li>/g)).toHaveLength(14)
    expect(html).toContain('<li>Filter</li>')
    expect(html).toContain('<li>Plate Reverb</li>')
    expect(html).toContain('<li>Dark Reverb</li>')
    expect(html).not.toContain('Other original FX2 effects remain available.')
    expect(html).not.toContain('Selection preview')
    expect(html).not.toContain('after your base firmware is checked')
    expect(render(['tapeecho'], { key: 'selection', state: 'valid', report: { ...report, omittedStockFx2: [] } })).toContain('No stock FX will be replaced.')
  })

  it('does not promise a replacement plan for a blocked configuration', () => {
    const html = render(['analog-bassdrum', 'tapeecho'], { key: 'selection', state: 'error', error: 'Incompatible modules' })
    expect(html).toContain('Resolve the module set issues to see')
    expect(html).not.toContain('<li>')
    expect(html).not.toContain('Selection preview')
    expect(html).not.toContain('No stock FX will be replaced.')
  })
})
