import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import draft from '../../sdk/drafts/stang-2/octamod.module.json'
import template from '../../sdk/drafts/stang-2/qualification.example.json'
import capture from '../../sdk/drafts/stang-2/media/capture.json'
import coreTests from '../../sdk/drafts/stang-2/media/core-tests.json'
import baseline from '../../sdk/module-qualification-baseline.json'
import { parseModuleDocument, requireModuleUiForPublication, requireModuleQualificationForPublication } from './module-contract'
import { moduleNativeSourceSha256, parseQualificationBaseline, requireFolderQualification } from '../../scripts/module-qualification.mjs'
import { requireCompleteReadme, requireMonochromePng } from '../../scripts/module-documentation.mjs'
import { MODULES, resolveSelection } from './modules'

const folder = resolve('sdk/drafts/stang-2')
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

describe('Stang 2 source draft', () => {
  it('keeps UI evidence separate from qualification and public/native availability', async () => {
    const document = parseModuleDocument(draft)
    expect(document.tests.hardwareStatus).toBe('untested')
    expect(() => requireModuleUiForPublication(document)).not.toThrow()
    expect(() => requireModuleQualificationForPublication(document)).toThrow('worst-case cycles, exact memory and hardware')
    await expect(requireFolderQualification(folder, document, parseQualificationBaseline(baseline))).rejects.toThrow('worst-case cycles, exact memory and hardware')
    expect(MODULES.some(module => module.id === document.id)).toBe(false)
    expect(() => resolveSelection([document.id])).toThrow('Unknown module')
    expect(await readdir(resolve('sdk/octabam/modules'))).not.toContain(document.id)
    expect(baseline.modules.some(module => module.id === document.id)).toBe(false)
  })

  it('binds reviewed monochrome captures and complete tutorial to the authored source', async () => {
    const document = parseModuleDocument(draft)
    expect(capture.moduleVersion).toBe(document.version)
    expect(capture.sourceSha256).toBe(await moduleNativeSourceSha256(folder, document))
    expect(template.documentation.screenshots).toEqual(document.access!.screenshots)
    requireCompleteReadme({ id: document.id, tests: { qualification: { documentation: { ...template.documentation, screenshotStyle: 'black-and-white' as const } } } }, await readFile(resolve(folder, 'README.md'), 'utf8'))
    for (const media of document.media) {
      const bytes = await readFile(resolve(folder, media.path))
      requireMonochromePng(bytes)
      expect(sha(bytes)).toBe(capture.screenshots[media.path.slice('media/'.length) as keyof typeof capture.screenshots])
      expect(media.otUi?.moduleVersion).toBe(document.version)
      expect(media.otUi?.imageSha256).toBe(capture.imageSha256)
    }
    for (const [path, hash] of Object.entries(capture.nativeBuildInputs)) {
      expect(sha(await readFile(resolve(folder, path)))).toBe(hash)
    }
    expect(sha(await readFile(resolve('scripts/capture-module-ui.py')))).toBe(capture.captureToolSha256)
  })

  it('binds the recorded firmware-free tests without running native code in application checks', async () => {
    expect(coreTests.moduleVersion).toBe(draft.version)
    for (const [path, hash] of Object.entries(coreTests.sources)) {
      expect(sha(await readFile(resolve(folder, path)))).toBe(hash)
    }
    const files = await readdir(folder, { recursive: true })
    expect(files.filter(file => /(?:runtime\.s|\.(?:bin|syx|elf|o|img|dmp|lcd))$/i.test(file))).toEqual([])
  })
})
