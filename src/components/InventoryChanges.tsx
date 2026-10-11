import { MODULES } from '../catalog/modules'
import { STOCK_EFFECT_NAMES } from '../catalog/stock-effects'
import type { InventoryChanges } from '../config/inventory'

const moduleName = (id: string) => MODULES.find(module => module.id === id)?.name ?? id

/** What a load will change on the Octatrack, shown before the user confirms. */
export function ChangeSummary({ changes }: { changes: InventoryChanges }) {
  const rows: [string, string[]][] = [
    ['Adds', changes.add.map(moduleName)], ['Removes', changes.remove.map(moduleName)],
    ['Switches off', changes.stockOff.map(key => STOCK_EFFECT_NAMES[key] ?? key)], ['Switches on', changes.stockOn.map(key => STOCK_EFFECT_NAMES[key] ?? key)],
  ]
  return <dl className="inventory-changes">{rows.filter(([, items]) => items.length).map(([label, items]) => <div key={label}><dt>{label}</dt><dd>{items.join(', ')}</dd></div>)}</dl>
}
