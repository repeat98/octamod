import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Configuration } from '../config/workspace'
import { FIRMWARE_SHARING_NOTICE, FLASHING_RISKS } from '../firmware-notices'
import { Icon } from './Icon'

type DialogMode = 'create' | 'rename' | 'duplicate' | 'delete'

// The configuration page header: the name is the switcher, New stays in view and the other actions sit in one menu.
export function ConfigurationHeader({ kicker, meta, emptyTitle, configuration, configurations, onSelect, onDialog, onImport, shareHref, canReport, onReport }: { kicker: string; meta: string; emptyTitle?: string; configuration?: Configuration; configurations: Configuration[]; onSelect: (id: string) => void; onDialog: (mode: DialogMode) => void; onImport: () => void; shareHref: string; canReport: boolean; onReport: () => void }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>('a, button:not(:disabled)')?.focus()
    const close = () => setOpen(false)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    const onPointer = (event: PointerEvent) => { if (!panelRef.current?.contains(event.target as Node) && !buttonRef.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('hashchange', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => { window.removeEventListener('hashchange', close); window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPointer) }
  }, [open])
  function moveFocus(event: ReactKeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a, button:not(:disabled)') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
    event.preventDefault()
  }
  // Focus returns to the menu button first, so a dialog opened by the action restores focus there.
  function choose(action: () => void) { setOpen(false); buttonRef.current?.focus(); action() }
  return <header className="page-heading configuration-heading">
    <div>
      <p className="page-kicker">{kicker}</p>
      <h1>{configuration ? <select className="configuration-switcher" aria-label="Choose module set" value={configuration.id} onChange={event => onSelect(event.target.value)}>{configurations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : emptyTitle}</h1>
      <p>{meta}</p>
    </div>
    <div className="configuration-heading-actions">
      <button className="button button-primary" onClick={() => onDialog('create')}><Icon name="plus" size={16} />New</button>
      {configuration && <div className="configuration-menu">
        <button ref={buttonRef} className="button button-quiet" aria-label="Module set actions" title="Module set actions" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(value => !value)}><Icon name="more" size={18} /></button>
        {open && <div ref={panelRef} id={panelId} className="configuration-menu-panel" role="group" aria-label="Module set actions" onKeyDown={moveFocus}>
          <button onClick={() => choose(() => onDialog('rename'))}>Rename</button>
          <button onClick={() => choose(() => onDialog('duplicate'))}>Duplicate</button>
          <button onClick={() => choose(onImport)}>Import JSON</button>
          <a href={shareHref}>Share in forum</a>
          <button disabled={!canReport} aria-haspopup="dialog" onClick={() => choose(onReport)}>Report a problem</button>
          <hr />
          <button className="is-danger" onClick={() => choose(() => onDialog('delete'))}>Delete</button>
        </div>}
      </div>}
    </div>
  </header>
}

// The flashing risks stay beside the build button; the backup advice and sharing notice are one click away.
export function RiskAcceptance({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="risk-acceptance">
    <p><strong>Before you flash.</strong> {FLASHING_RISKS}</p>
    <details><summary>Backups and sharing</summary><p>Back up your projects and samples, review the module test records, and keep the original OS. Flash at your own risk.</p><p>{FIRMWARE_SHARING_NOTICE}</p></details>
    <label className="risk-accept"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span>I understand the risks of flashing custom firmware.</span></label>
  </div>
}
