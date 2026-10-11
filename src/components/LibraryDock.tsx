import { Icon } from './Icon'

export type LibraryDockProps = {
  compared: readonly string[]
  onClearComparison: () => void
  onCompare: () => void
  build: { count: number; detail: string; href: string } | null
}

// Phones: the library's actions wait at the bottom of the screen and appear only when there is something to act on.
// Ticking modules to compare takes precedence; otherwise a configuration with modules offers its build.
export function LibraryDock({ compared, onClearComparison, onCompare, build }: LibraryDockProps) {
  if (compared.length) return <div className="library-dock" role="region" aria-label="Comparison">
    <span className="library-dock-copy"><strong>{compared.length} of 3 to compare</strong><small>{compared.join(', ')}</small></span>
    <button type="button" className="button button-quiet" onClick={onClearComparison}>Clear</button>
    <button type="button" className="button button-primary" disabled={compared.length < 2} onClick={onCompare}>Compare</button>
  </div>
  if (!build) return null
  return <div className="library-dock" role="region" aria-label="Your module set">
    <span className="library-dock-icon" aria-hidden="true"><Icon name="sliders" size={18} /></span>
    <span className="library-dock-copy"><strong>{build.count} {build.count === 1 ? 'module' : 'modules'} added</strong><small>{build.detail}</small></span>
    <a className="button button-primary" href={build.href}>Build firmware</a>
  </div>
}
