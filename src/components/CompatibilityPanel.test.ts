import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CompatibilityPanel } from './CompatibilityPanel'
import { explainBuildFailure } from '../engine/build-errors'
import type { BuildView } from '../hooks/useFirmwareBuild'
import type { SelectionConflict } from '../catalog/selection-conflicts'

const reportedSelection = ['euclid', 'vector', 'sidechain-compressor', 'tapehead', 'tapeecho', 'miniverb', 'previewvol', 'repitch']
function render(state: BuildView['state'], error?: string, ids = reportedSelection) {
  return renderToStaticMarkup(createElement(CompatibilityPanel, { ids, keepStockFx2: false, buildState: state, buildError: error, onFix: () => {} }))
}

describe('configuration placement status', () => {
  it('renders named placement failures and complete verified removal choices', () => {
    const conflict: SelectionConflict = { id: 'build-placement-space', title: 'This selection needs more menu and patch space', description: 'Mute Modes menu and patch code does not fit (208 bytes needed, 60 bytes available). Removing one module is insufficient.', moduleIds: ['mute-modes'], fixes: [{ label: 'Remove Euclid + Mute Modes', removeIds: ['euclid', 'mute-modes'] }] }
    const ids = ['miniverb', 'tapeecho', 'euclid', 'repitch', 'tapehead', 'analog-bassdrum', 'previewvol', 'sidechain-compressor', 'playmodes', 'mute-modes', 'recorder-loop-fix']
    const props = { ids, keepStockFx2: false, buildState: 'error' as const, buildError: conflict.description, buildConflict: conflict, onFix: () => {} }
    const html = renderToStaticMarkup(createElement(CompatibilityPanel, props))
    expect(html).toContain('compatibility-conflict')
    expect(html).toContain('208 bytes needed, 60 bytes available')
    expect(html).toContain('Remove Euclid + Mute Modes')
    expect(html).not.toContain('Choose your base firmware')
    const changed = renderToStaticMarkup(createElement(CompatibilityPanel, { ...props, buildState: 'validating' }))
    expect(changed).not.toContain('Remove Euclid + Mute Modes')
  })
  it.each(['mute-modes', 'recorder-loop-fix'])('shows the placement refusal for the reported selection with %s', id => {
    const error = explainBuildFailure('A module menu cave exceeds its reserved region.')
    const html = render('error', error, [...reportedSelection, id])
    expect(html).toContain('Module set needs attention')
    expect(html).toContain(error)
    expect(html).toContain('menu and patch space')
    expect(html).not.toContain('Choose your base firmware')
  })

  it('shows worker and firmware failures without implying the base is absent', () => {
    const error = 'The local firmware worker stopped. Choose your file again or reload the page.'
    expect(render('error', error)).toContain(error)
    expect(render('error')).toContain('Review the build details below, then check again.')
    expect(render('error')).not.toContain('Choose your base firmware')
  })

  it('shows checks in progress after firmware selection', () => {
    const html = render('validating')
    expect(html).toContain('Checking module set')
    expect(html).toContain('Checking whether your modules fit in the selected base firmware')
    expect(html).not.toContain('Choose your base firmware')
  })

  it('retains the firmware prompt before checks and the checked state afterwards', () => {
    expect(render('empty')).toContain('Choose your base firmware for placement checks.')
    expect(render('valid')).toContain('Module set fits')
    expect(render('valid')).toContain('Selection and placement checks passed locally.')
  })

  it('keeps declared conflict explanations and fixes ahead of the build error', () => {
    const html = render('error', 'Placement failed', ['midi-scenes', 'repitch'])
    expect(html).toContain('Build MIDI Scenes on its own')
    expect(html).toContain('Remove MIDI Scenes')
    expect(html).not.toContain('Placement failed')
  })
})
