import { useEffect, useRef } from 'react'
import { moduleNameList, type AddBlock } from '../catalog/add-blocks'
import { Icon } from './Icon'

// A one-line note that stands in for the module's type on a card, and a prompt that opens from the add button, for a
// module that conflicts with the configuration. Neither takes space in the layout: the chip replaces a line that is
// already there and the prompt floats over it. A conflict never disables the add, because a configuration with
// conflicts can be saved and fixed later. The prompt offers the swap that avoids it.
export function AddBlockChip({ block }: { block: AddBlock }) {
  return <span className={'add-block-chip' + (block.kind === 'conflict' ? ' is-conflict' : '')} title={block.detail}><Icon name={block.kind === 'conflict' ? 'swap' : 'sliders'} size={12} /><span className="add-block-label">{block.reason}</span></span>
}

export function AddBlockPrompt({ id, name, block, onSwap, onAddAnyway, onCancel }: { id: string; name: string; block: AddBlock; onSwap: () => void; onAddAnyway: () => void; onCancel: () => void }) {
  const swap = block.swapRemoveIds
  const ref = useRef<HTMLDivElement>(null)
  // The prompt covers the button that opened it, so focus moves in with it.
  useEffect(() => { ref.current?.querySelector('button')?.focus() }, [])
  return <div ref={ref} className="add-block-prompt" id={id} role="group" aria-label={name + ' conflicts with your module set'} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}>
    <strong className="add-block-title">{block.reason}</strong>
    <p>{block.detail}</p>
    <div className="add-block-actions">
      {swap && <button type="button" className="button button-primary add-block-swap" onClick={onSwap}><Icon name="swap" size={14} />{'Remove ' + (swap.length > 2 ? swap.length + ' modules' : moduleNameList(swap)) + ' and add ' + name}</button>}
      <button type="button" className="button button-quiet" onClick={onAddAnyway} title="Add it and choose what to keep in your module set">Add anyway</button>
      <button type="button" className="button button-quiet" onClick={onCancel}>Cancel</button>
    </div>
  </div>
}
