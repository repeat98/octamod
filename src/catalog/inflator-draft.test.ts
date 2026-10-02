import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import draft from '../../sdk/drafts/inflator/octamod.module.json'
import template from '../../sdk/drafts/inflator/qualification.example.json'
import baseline from '../../sdk/module-qualification-baseline.json'
import { parseModuleDocument, requireModuleUiForPublication, requireModuleQualificationForPublication } from './module-contract'
import { parseQualificationBaseline, requireFolderQualification } from '../../scripts/module-qualification.mjs'
import { requireCompleteReadme, requireMonochromePng } from '../../scripts/module-documentation.mjs'
import capture from '../../sdk/drafts/inflator/media/capture.json'
import { MODULES, resolveSelection } from './modules'

const folder = resolve('sdk/drafts/inflator')

describe('Inflator source draft', () => {
  it('parses, has UI evidence, stays out of the catalog and is refused for publication without qualification', async () => {
    const document = parseModuleDocument(draft)
    expect(document.compatibility.effectId).toBe(0x1b)
    expect(document.tests.hardwareStatus).toBe('untested')
    expect(() => requireModuleUiForPublication(document)).not.toThrow()
    expect(() => requireModuleQualificationForPublication(document)).toThrow('worst-case cycles, exact memory and hardware')
    await expect(requireFolderQualification(folder, document, parseQualificationBaseline(baseline))).rejects.toThrow('worst-case cycles, exact memory and hardware')
    expect(baseline.modules.some(module => module.id === document.id)).toBe(false)
    expect(MODULES.some(module => module.id === document.id)).toBe(false)
    expect(() => resolveSelection([document.id])).toThrow('Unknown module')
  })

  it('documents every section, the declared tutorial and the tested source', async () => {
    const document = parseModuleDocument(draft)
    expect(template.moduleVersion).toBe(document.version)
    const source = await readFile(resolve(folder, 'inflator.asm'))
    expect(createHash('sha256').update(source).digest('hex')).toBe(template.sourceSha256)
    requireCompleteReadme({ id: document.id, tests: { qualification: { documentation: { ...template.documentation, screenshotStyle: 'black-and-white' as const } } } }, await readFile(resolve(folder, 'README.md'), 'utf8'))
    expect(document.controls.map(control => control.name)).toEqual(['INPUT', 'EFFCT', 'CURVE', 'CLIP', 'SPLIT', 'OUT'])
    expect(template.documentation.screenshots).toEqual(document.access!.screenshots)
    for (const media of document.media) {
      const bytes = await readFile(resolve(folder, media.path))
      requireMonochromePng(bytes)
      expect(capture.screenshots.find(shot => shot.path === media.path)?.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(media.otUi?.moduleVersion).toBe(document.version)
      expect(media.otUi?.imageSha256).toBe(capture.imageSha256)
    }
  })
})
