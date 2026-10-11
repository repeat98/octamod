import { useState } from 'react'
import type { LinkState, OctatrackLink } from '../engine/elekloader/octatrack-link'
import { useOctatrackLink } from '../hooks/useOctatrackLink'
import { Icon } from './Icon'
import './octatrack-link.css'

const ACTIVE: LinkState['status'][] = ['sending', 'testing', 'trial', 'finishing']
const activity = ({ status, progress = 0 }: LinkState) => status === 'sending' ? `Loading ${Math.round(progress * 100)}%`
  : status === 'testing' ? 'Stress-testing' : status === 'trial' ? 'Waiting for Keep or Undo' : 'Finishing'

/** The Octatrack's connection in the sidebar (`sidebar`, leading to Your Octatrack) or the status bar (`bar`). Nothing without WebUSB. */
export function OctatrackStatus({ link, variant }: { link: OctatrackLink; variant: 'sidebar' | 'bar' }) {
  const state = useOctatrackLink(link), { status, identity } = state
  if (status === 'unsupported') return null
  const base = !!identity?.canSubmit, busy = ACTIVE.includes(status)
  const dot = <span className={'status-dot' + (busy ? ' is-live' : base ? ' verified' : '')} />
  const title = busy ? 'Loading onto Octatrack' : status === 'idle' ? 'Connect your Octatrack' : status === 'connecting' ? 'Looking for your Octatrack…' : status === 'busy' ? 'Octatrack in use' : 'Octatrack connected'
  const detail = busy ? activity(state) : status === 'idle' ? 'Updates, tests and reports over USB' : status === 'busy' ? 'Another tab or app has it'
    : base ? 'Modwerk base ' + identity!.base.slice(0, 8) : status === 'connecting' ? 'Over USB' : 'Original OS · install the base'
  if (variant === 'bar') return status === 'idle' || status === 'connecting' ? null : <span className="octatrack-status-bar">{dot}{title}{busy && ' · ' + activity(state)}</span>
  return <a className="sidebar-build octatrack-status" href="#your-octatrack">{dot}<span className="sidebar-build-copy"><strong>{title}</strong><small>{detail}</small></span><Icon name="arrow" size={14} /></a>
}

/** A pill while an update runs or waits for Keep or Undo, and for its result, on every page but the configuration page. */
export function OctatrackActivity({ link }: { link: OctatrackLink }) {
  const state = useOctatrackLink(link), { status, module, notice } = state
  const [dismissed, setDismissed] = useState<LinkState['notice']>()
  const result = notice && notice !== dismissed && !ACTIVE.includes(status) ? notice : undefined
  if (!ACTIVE.includes(status) && !result) return null
  return <aside className={'octatrack-activity' + (result?.tone === 'error' ? ' is-error' : '')} aria-label="Octatrack update" role="status">
    {result ? <><span>{result.text}</span><button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setDismissed(notice)}><Icon name="close" size={15} /></button></>
      : <><span className="status-dot is-live" /><span><strong>{module}</strong> · {activity(state)}</span>
        {(status === 'trial' || status === 'finishing') && <><button type="button" className="button button-primary" disabled={status === 'finishing'} onClick={() => void link.keep()}>Keep</button><button type="button" className="button button-quiet" disabled={status === 'finishing'} onClick={() => void link.undo()}>Undo</button></>}
        <a className="text-button" href="#configuration">Open</a></>}
  </aside>
}
