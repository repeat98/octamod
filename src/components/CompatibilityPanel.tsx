import { moduleHref } from '../routing'
import { checkSelection } from '../catalog/compatibility'
import { resolveSelection } from '../catalog/modules'
import type { ConflictFix, SelectionConflict } from '../catalog/selection-conflicts'
import type { BuildView } from '../hooks/useFirmwareBuild'
import { Icon } from './Icon'

export function CompatibilityPanel({ ids, keepStockFx2, buildState, buildError, buildConflict, onFix }: { ids: readonly string[]; keepStockFx2: boolean; buildState?: BuildView['state']; buildError?: string; buildConflict?: SelectionConflict; onFix: (fix: ConflictFix) => void }) {
  const result = checkSelection(ids, keepStockFx2)
  const conflicts = result.conflicts.length ? result.conflicts : buildState === 'error' && buildConflict ? [buildConflict] : []
  const fits = ['valid', 'building', 'built'].includes(buildState ?? '')
  const tone = conflicts.length ? 'conflict' : result.issues.length || buildState === 'error' ? 'pending' : 'clear'
  return <section className={'compatibility-panel compatibility-' + tone} aria-live="polite" aria-labelledby="compatibility-title">
    <div className="compatibility-heading"><span className="compatibility-icon"><Icon name={tone === 'conflict' ? 'sliders' : tone === 'clear' && ids.length ? 'check' : 'shield'} size={20} /></span><div><h2 id="compatibility-title">{!ids.length ? 'Choose your modules' : conflicts.length ? 'Some modules cannot run together' : result.issues.length ? 'Build verification pending' : buildState === 'error' ? 'Module set needs attention' : buildState === 'validating' ? 'Checking module set' : fits ? 'Module set fits' : 'No declared conflicts'}</h2><p>{conflicts.length ? 'Choose what to keep. Your module set stays saved while you make changes.' : !ids.length ? 'Add a module from the library. Compatibility updates as you make changes.' : result.issues.length ? 'You can save this module set while verification is pending.' : buildState === 'error' ? buildError || 'The module set could not be checked. Review the build details below, then check again.' : buildState === 'validating' ? 'Checking whether your modules fit in the selected base firmware…' : fits ? 'Selection and placement checks passed locally. This module set has not been qualified on hardware.' : 'Module claims were checked. Choose your base firmware for placement checks.'}</p></div></div>
    {!!conflicts.length && <div className="compatibility-conflicts">{conflicts.map(conflict => <article className="conflict-card" key={conflict.id}><h3>{conflict.title}</h3><div className="conflict-modules">{resolveSelection(conflict.moduleIds).map(module => <a key={module.id} href={moduleHref(module.id)}>{module.name}</a>)}</div><p>{conflict.description}</p><div className="conflict-actions">{conflict.fixes.map(fix => <button className="button button-quiet" key={fix.label} onClick={() => onFix(fix)}>{fix.label}<Icon name="arrow" size={14} /></button>)}</div></article>)}</div>}
    {!!result.notes.length && <ul className="compatibility-notes">{result.notes.map(note => <li key={note}>{note}</li>)}</ul>}
  </section>
}
