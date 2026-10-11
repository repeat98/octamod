import { describe, expect, it } from 'vitest'
import { createSelection, parseSelection } from '../config/selection'
import { validateConfiguration } from '../config/workspace'
import { normalizeRemovedStockFx } from './stock-effects'

describe('stock effects switched off in a module set', () => {
  it('keeps known effects once each in menu order, and none as undefined', () => {
    expect(normalizeRemovedStockFx(['SPRING REV', 'FILTER', 'SPRING REV'])).toEqual(['FILTER', 'SPRING REV'])
    expect(normalizeRemovedStockFx([])).toBeUndefined()
    expect(normalizeRemovedStockFx(undefined)).toBeUndefined()
    expect(() => normalizeRemovedStockFx(['NOT AN EFFECT'])).toThrow()
    expect(() => normalizeRemovedStockFx('FILTER')).toThrow()
  })
  it('survives saving and a backup round trip, for the Octatrack only', () => {
    const saved = { id: 'a', name: 'Set', moduleIds: [], keepStockFx2: true, createdAt: '2026-10-11', updatedAt: '2026-10-11', removedStockFx: ['DARK REV'] }
    expect(validateConfiguration(saved).removedStockFx).toEqual(['DARK REV'])
    expect(validateConfiguration({ ...saved, device: 'digitakt' }).removedStockFx).toBeUndefined()
    const backup = JSON.stringify({ ...createSelection([], null, true, {}, undefined, ['PLATE REV']), name: 'Set' })
    expect(parseSelection(backup).removedStockFx).toEqual(['PLATE REV'])
    expect(parseSelection(JSON.stringify({ ...createSelection([], null, true, {}), name: 'Set' })).removedStockFx).toBeUndefined()
  })
})
