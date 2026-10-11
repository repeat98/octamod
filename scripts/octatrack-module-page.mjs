// SPDX-License-Identifier: GPL-3.0-or-later
// A module effect's FX page as a recipe the DSP-loader base builds at runtime (sdk/machines/octatrack/
// elekloader/fxpage.c), for sdk/runtime/loader/build.py --dsp: the stock donor descriptor, the integer and
// text patches (src/engine/assets/descriptor-recipes.json) and each formatter's code (menu-recipes.json,
// Modwerk's emitters and ROM units), with the words in it that hold module-relative addresses (relocations,
// for the loader) and descriptor-relative ones (fixups, for the base). Prints JSON; no stock bytes.
// Usage: node scripts/octatrack-module-page.mjs MODULE_ID. Node 24.
import path from 'node:path'
import { registerHooks } from 'node:module'
// The app uses bundler resolution and Vite's import.meta.env; neither exists in Node.
registerHooks({
  resolve(specifier, context, next) {
    const local = specifier.startsWith('./') || specifier.startsWith('../')
    const resolved = local && !path.extname(specifier) ? specifier + '.ts' : specifier
    const attributes = local && resolved.endsWith('.json') ? { type: 'json' } : context.importAttributes
    return { ...next(resolved, { ...context, importAttributes: attributes }), importAttributes: attributes }
  },
  load(url, context, next) {
    const result = next(url, context)
    return url.endsWith('.ts') ? { ...result, source: String(result.source).replaceAll('import.meta.env.DEV', 'false') } : result
  },
})
const { readFileSync } = await import('node:fs')
const { emitLabelFormatter, emitModeFormatter } = await import('../src/engine/menu-formatters.ts')
const { readRomPackage, linkRomText } = await import('../src/engine/rom-package.ts')
const json = name => JSON.parse(readFileSync(new URL('../src/engine/assets/' + name, import.meta.url), 'utf8'))
const id = process.argv[2], descriptors = json('descriptor-recipes.json'), menus = json('menu-recipes.json')
const recipe = descriptors.recipes.find(recipe => recipe.id === id)
if (!recipe) throw new Error('No FX page recipe for ' + id + '.')
if (recipe.rawPointers || recipe.replaces) throw new Error(id + ' replaces a stock effect in place; its page needs the base, not a recipe.')
const hex = bytes => Buffer.from(bytes).toString('hex')
// Words that differ between two links: by `delta` they hold that base; any other difference is refused.
function differing(a, b, delta) {
  if (a.length !== b.length || a.length % 2) throw new Error('A formatter links to different sizes.')
  const at = [], x = Buffer.from(a), y = Buffer.from(b)
  for (let i = 0; i < a.length; i += 2) {
    if (x.readUInt16BE(i) === y.readUInt16BE(i)) continue
    // A changed halfword starts the word that holds the base (its high half moves first).
    if (i + 4 > a.length || ((y.readUInt32BE(i) - x.readUInt32BE(i)) >>> 0) !== delta) throw new Error('A formatter word moves by something other than its base.')
    at.push(i); i += 2
  }
  return at
}
const D = 0x10000
const formatters = []
for (const menu of menus.recipes.filter(menu => menu.id === id)) {
  const renames = menu.renames ?? {}
  const emit = names => Object.keys(renames).length ? emitModeFormatter(menu.labels, names + 0x16, renames) : emitLabelFormatter(menu.labels)
  const at0 = emit(0)
  formatters.push({ slot: menu.slot, code: hex(at0), relocations: [], fixups: differing(at0, emit(D), D), clearWidget: false })
}
// ROM unit formatters (module-menus.ts): Spectrum's SHPE knows its own descriptor; Tape Echo's TIME does not.
const units = { spectrum: ['spectrum-shape', 7, 'CLONE_SPECTRUM'], tapeecho: ['tape-time', 0, null] }
if (units[id]) {
  const [label, slot, symbol] = units[id], object = await readRomPackage(label)
  const even = bytes => bytes.length % 2 ? Uint8Array.from([...bytes, 0]) : bytes // code halfwords; a unit may end on a string
  const link = (base, descriptor) => even(linkRomText(object, base, symbol ? new Map([[symbol, descriptor]]) : new Map()).bytes)
  const at0 = link(0, 0)
  formatters.push({ slot, code: hex(at0), relocations: differing(at0, link(D, 0), D), fixups: symbol ? differing(at0, link(0, D), D) : [], clearWidget: true })
}
if (menus.recipes.some(menu => menu.id === id && menu.wideMaximum !== null)) throw new Error(id + ' needs the shared wide dial, a base seam.')
console.log(JSON.stringify({ id, donor: recipe.donorAddress, donorSha256: recipe.donorSha256, integers: recipe.integers,
  strings: recipe.strings, inheritedEnable: recipe.inheritedEnable ?? [], formatters }))
