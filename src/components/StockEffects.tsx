import { STOCK_EFFECT_NAMES, STOCK_EFFECTS } from '../catalog/stock-effects'

/** Which stock effects stay in the Octatrack's menus, for a module set or the unit itself. */
export function StockEffects({ removed, onChange, disabled = false }: { removed: readonly string[]; onChange: (removed: string[]) => void; disabled?: boolean }) {
  const off = new Set(removed)
  return <section className="configuration-section stock-effects" aria-labelledby="stock-effects-title">
    <div className="section-title"><h2 id="stock-effects-title">Stock effects</h2><span className="subtle">{STOCK_EFFECTS.length - off.size} of {STOCK_EFFECTS.length} in the menus</span></div>
    <p className="service-note">Switch off the ones you never use, and they leave the FX menus.</p>
    <ul className="stock-effect-toggles">{STOCK_EFFECTS.map(key => <li key={key}><label className={off.has(key) ? undefined : 'is-on'}>
      <input type="checkbox" checked={!off.has(key)} disabled={disabled} onChange={event => onChange(event.target.checked ? removed.filter(item => item !== key) : [...removed, key])} />
      <span>{STOCK_EFFECT_NAMES[key] ?? key}</span>
    </label></li>)}</ul>
  </section>
}
