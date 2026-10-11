import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSheetScrollLock } from '../hooks/useSheetScrollLock'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { SupportButton } from './SupportDialog'

type MenuLink = { href: string; label: string; icon: IconName; current: boolean; count?: number; online?: number | null; isNew?: boolean }

// Phone-width home for the destinations the desktop sidebar lists under Module sets, Community and Help.
// It opens as a bottom sheet, within thumb reach, and renders outside the app bar so the bar's stacking never clips it.
export function MobileMenu({ route, online, selectedCount, configurationHref, admin, developer, onSupport, onConfigurations }: { route: string; online?: number | null; selectedCount: number; configurationHref?: string; admin: boolean; developer?: boolean; onSupport?: () => void; onConfigurations?: () => void }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  useSheetScrollLock(open)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() } }
    window.addEventListener('hashchange', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('hashchange', close); window.removeEventListener('keydown', onKey) }
  }, [open])
  const groups: MenuLink[][] = [
    [
      { href: '#all', label: 'All modules', icon: 'grid', current: route === 'all' },
      ...(configurationHref ? [{ href: configurationHref, label: 'Module set', icon: 'sliders' as const, current: route === 'configuration' || route.endsWith('/configuration'), count: selectedCount }] : []),
    ],
    [
      { href: '#forum', label: 'Forum', icon: 'message', current: route.startsWith('forum'), online },
      { href: '#projects', label: 'Other projects', icon: 'external', current: route.split('?')[0] === 'projects', isNew: true },
      { href: '#account', label: 'Account / sign in', icon: 'shield', current: route.startsWith('account') },
      ...(developer ? [{ href: '#developer', label: 'Creator settings', icon: 'sliders' as const, current: route.startsWith('developer') }] : []),
      { href: '#submit', label: 'Start developing', icon: 'plus', current: route.startsWith('submit') },
      ...(admin ? [{ href: '#admin', label: 'Admin workspace', icon: 'shield' as const, current: route === 'admin' || route === 'review' }] : []),
    ],
    [
      { href: '#faq', label: 'FAQ & flashing guide', icon: 'help', current: route === 'faq' },
      { href: '#credits', label: 'Credits & acknowledgements', icon: 'heart', current: route === 'credits' },
      { href: '#privacy', label: 'Privacy', icon: 'shield', current: route === 'privacy' },
    ],
  ]
  return (
    <div className="mobile-menu">
      <button ref={buttonRef} type="button" className="mobile-menu-button" aria-label="Menu" aria-expanded={open} aria-controls="mobile-menu-panel" onClick={() => setOpen(value => !value)}>{open ? <Icon name="close" size={20} /> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>}</button>
      {open && createPortal(<>
        <div className="mobile-menu-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
        <nav id="mobile-menu-panel" className="mobile-menu-panel" aria-label="Menu">
          <div className="sheet-head"><span className="sheet-handle" aria-hidden="true" /><strong>Menu</strong><button type="button" className="sheet-close" aria-label="Close menu" onClick={() => { setOpen(false); buttonRef.current?.focus() }}><Icon name="close" size={18} /></button></div>
          {groups.map((links, index) => <div key={index} className="mobile-menu-group">{links.map(link => <a key={link.href} href={link.href} aria-current={link.current ? 'page' : undefined} onClick={() => setOpen(false)}><Icon name={link.icon} size={18} /><span>{link.label}</span>{link.isNew && <small className="menu-feature-new">New</small>}{link.count !== undefined && <small>{link.count}</small>}{link.online ? <small className="menu-online"><span className="online-dot" aria-hidden="true"/>{link.online} online</small> : null}</a>)}{index === 0 && onConfigurations && <button type="button" onClick={() => { setOpen(false); buttonRef.current?.focus(); onConfigurations() }}><Icon name="file" size={18} /><span>Saved module sets</span></button>}</div>)}

          {onSupport && <div className="mobile-menu-support"><SupportButton onClick={() => { setOpen(false); buttonRef.current?.focus(); onSupport() }} /></div>}
        </nav>
      </>, document.body)}
    </div>
  )
}
