import metadata from '../engine/assets/chooser-metadata.json'

/** The Octatrack's stock effects by the key its menus use: FX1 offers the first ten, FX2 all fourteen. */
export const STOCK_EFFECTS: readonly string[] = metadata.stockFx2
export const STOCK_EFFECT_NAMES: Record<string, string> = {
  FILTER: 'Filter', EQUALIZER: 'Equalizer', 'DJ EQ': 'DJ EQ', PHASER: 'Phaser',
  FLANGER: 'Flanger', CHORUS: 'Chorus', SPATIALIZER: 'Spatializer',
  'COMB FILTER': 'Comb Filter', COMPRESSOR: 'Compressor', 'LO-FI': 'Lo-Fi',
  DELAY: 'Delay', 'PLATE REV': 'Plate Reverb', 'SPRING REV': 'Spring Reverb', 'DARK REV': 'Dark Reverb',
}

/** A module set's switched-off stock effects: known keys only, once each, in menu order; none is undefined. */
export function normalizeRemovedStockFx(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(key => typeof key === 'string' && STOCK_EFFECTS.includes(key))) throw new Error('Saved stock effect choices are unreadable.')
  const keys = STOCK_EFFECTS.filter(key => value.includes(key))
  return keys.length ? keys : undefined
}
