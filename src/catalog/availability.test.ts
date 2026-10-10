import { moduleBuildError } from './build-support'
import { checkSelection } from './compatibility'
import { describe, expect, it } from 'vitest'
import { AVAILABLE_MODULES, availableModules, PAUSED_MODULE_IDS, isModuleAvailable, moduleAvailabilityError } from './availability'
import { MODULES, resolveSelection } from './modules'
import { newConfiguration, validateConfiguration } from '../config/workspace'

describe('temporary module availability', () => {
  it('keeps every visible module buildable as an individual selection', () => {
    for (const module of AVAILABLE_MODULES) {
      expect(moduleBuildError([module.id])).toBe('')
      expect(checkSelection([module.id], false).checked).toBe(true)
    }
  })
  it('offers every catalog module that is not paused and retains their GitHub identity', () => {
    expect(AVAILABLE_MODULES.map(module => module.id)).toEqual(MODULES.map(module => module.id).filter(id => !PAUSED_MODULE_IDS.includes(id)))
    expect(AVAILABLE_MODULES.map(module => module.id)).toContain('sidechain-compressor')
    for (const module of AVAILABLE_MODULES.filter(module=>['miniverb','tapeecho','euclid','repitch','analog-bassdrum'].includes(module.id))) {
      expect(module.authorName).toBe('Jannik Aßfalg')
      expect(module.author).toBe('repeat98')
      expect(module.authorUrl).toBe('https://github.com/repeat98')
    }
    for (const id of ['spectrum', 'modulation', 'character', 'airwindows-chorus', 'midi-scenes', 'unknown']) expect(isModuleAvailable(id)).toBe(false)
  })
  it('keeps older configurations readable and flags their paused modules before a build', () => {
    const saved = newConfiguration('Older configuration', ['spectrum', 'euclid', 'character', 'airwindows-chorus', 'midi-scenes'])
    const restored = validateConfiguration(saved)
    expect(restored.moduleIds).toEqual(saved.moduleIds)
    expect(restored.moduleVersions).toEqual(saved.moduleVersions)
    expect(moduleAvailabilityError(restored.moduleIds)).toContain('Spectrum, Character')
    expect(moduleAvailabilityError(restored.moduleIds)).toContain('Air Chorus')
    expect(moduleAvailabilityError(restored.moduleIds)).toContain('MIDI Scenes')
    expect(moduleAvailabilityError(restored.moduleIds)).toContain('Remove these modules')
    expect(resolveSelection(['spectrum', 'modulation', 'character', 'airwindows-chorus'])).toHaveLength(4)
  })
  it('offers and builds only Air Chorus for beta access while retaining other pauses', () => {
    expect(availableModules(true).map(module => module.id)).toEqual([...MODULES].filter(module => !PAUSED_MODULE_IDS.includes(module.id) || module.id === 'airwindows-chorus').map(module => module.id))
    expect(isModuleAvailable('airwindows-chorus', true)).toBe(true)
    expect(moduleAvailabilityError(['airwindows-chorus'], true)).toBe('')
    expect(moduleAvailabilityError(['spectrum', 'airwindows-chorus'], true)).toContain('Spectrum')
    expect(moduleBuildError(['airwindows-chorus'])).toBe('')
    expect(checkSelection(['airwindows-chorus'], false).checked).toBe(true)
  })
  it('allows available selections and still rejects unknown catalog identities', () => {
    expect(moduleAvailabilityError(AVAILABLE_MODULES.map(module => module.id))).toBe('')
    expect(moduleAvailabilityError([])).toBe('')
    expect(() => moduleAvailabilityError(['unknown'])).toThrow('Unknown module')
  })
})
