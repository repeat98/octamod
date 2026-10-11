// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addBlock } from '../catalog/add-blocks'
import { DETAILS } from '../catalog/details'
import { MODULES } from '../catalog/modules'
import { ModuleCard } from './ModuleCard'

const spectrum = MODULES.find(module => module.id === 'spectrum')!
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

function card(props: Partial<Parameters<typeof ModuleCard>[0]> = {}) {
  const calls = { toggle: vi.fn(), swap: vi.fn() }
  const render = (extra: Partial<Parameters<typeof ModuleCard>[0]> = {}) => act(() => root.render(createElement(ModuleCard, {
    module: spectrum, selected: false, baseline: null, compared: false, canCompare: true, onToggle: calls.toggle, onCompare: () => {}, onSwap: calls.swap, ...props, ...extra,
  })))
  return { calls, render }
}
const addButton = () => container.querySelector<HTMLButtonElement>('.add-button')!
const prompt = () => container.querySelector('.add-block-prompt')
const click = (element: Element) => act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const buttonNamed = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent?.includes(text))!

describe('a conflicting add in the library', () => {
  it('shows the conflict before any click and keeps the card readable', async () => {
    await card({ block: addBlock(['analog-bassdrum'], 'spectrum') }).render()
    expect(container.querySelector('.add-block-chip.is-conflict')?.textContent).toBe('Conflicts with Analog BD')
    expect(container.querySelector('.module-card-heading a')?.textContent).toBe('Spectrum')
    expect(addButton().classList.contains('is-conflict')).toBe(true)
    expect(addButton().disabled).toBe(false)
    expect(addButton().getAttribute('aria-expanded')).toBe('false')
    expect(addButton().getAttribute('aria-label')).toContain('Conflicts with Analog BD')
    expect(prompt()).toBeNull()
  })
  it('adds no row to the card: the note replaces the type line and the prompt floats over the card', async () => {
    const { render } = card({ block: addBlock(['analog-bassdrum'], 'spectrum') })
    await render()
    const bottom = container.querySelector('.card-bottom')!
    expect(bottom.firstElementChild?.classList.contains('add-block-chip')).toBe(true)
    expect(bottom.textContent).not.toContain(DETAILS.spectrum.family)
    await click(addButton())
    const article = container.querySelector('article')!
    expect(prompt()?.parentElement).toBe(article)
    expect(container.querySelector('.module-card-body')?.contains(prompt())).toBe(false)
  })
  it('puts focus in the prompt and makes the covered card inert while it is open', async () => {
    const { render } = card({ block: addBlock(['analog-bassdrum'], 'spectrum') })
    await render()
    expect(container.querySelector('.module-card-body')?.hasAttribute('inert')).toBe(false)
    await click(addButton())
    expect(prompt()?.contains(document.activeElement)).toBe(true)
    expect(container.querySelector('.module-card-body')?.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('.module-cover')?.hasAttribute('inert')).toBe(true)
    await click(buttonNamed('Cancel'))
    expect(container.querySelector('.module-card-body')?.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(addButton())
  })
  it('does not add when the button is pressed; it opens a prompt with the swap', async () => {
    const { calls, render } = card({ block: addBlock(['analog-bassdrum'], 'spectrum') })
    await render()
    await click(addButton())
    expect(calls.toggle).not.toHaveBeenCalled()
    expect(addButton().getAttribute('aria-expanded')).toBe('true')
    expect(addButton().getAttribute('aria-controls')).toBe(prompt()?.id)
    expect(prompt()?.textContent).toContain('cannot run alongside Spectrum')
    expect(buttonNamed('Remove Analog BD and add Spectrum')).toBeTruthy()
  })
  it('swaps by handing the modules to remove to the library', async () => {
    const { calls, render } = card({ block: addBlock(['analog-bassdrum'], 'spectrum') })
    await render()
    await click(addButton())
    await click(buttonNamed('Remove Analog BD and add Spectrum'))
    expect(calls.swap).toHaveBeenCalledWith(['analog-bassdrum'])
    expect(calls.toggle).not.toHaveBeenCalled()
    expect(prompt()).toBeNull()
  })
  it('still lets the user add anyway, or back out with Escape and keep focus on the button', async () => {
    const { calls, render } = card({ block: addBlock(['analog-bassdrum'], 'spectrum') })
    await render()
    await click(addButton())
    await click(buttonNamed('Add anyway'))
    expect(calls.toggle).toHaveBeenCalledTimes(1)
    expect(calls.swap).not.toHaveBeenCalled()
    await click(addButton())
    await act(() => { prompt()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(prompt()).toBeNull()
    expect(document.activeElement).toBe(addButton())
  })
  it('offers only the explanation when the rules name no swap', async () => {
    await card({ block: addBlock(['miniverb', 'tapeecho', 'repitch', 'quantizer'], 'euclid') }).render()
    expect(addButton().textContent).toBe('Review')
    await click(addButton())
    expect(buttonNamed('Add anyway')).toBeTruthy()
    expect([...container.querySelectorAll('.add-block-actions button')].some(button => button.textContent?.startsWith('Remove'))).toBe(false)
  })
  it('closes the prompt when the selection it described changes', async () => {
    const { render } = card({ block: addBlock(['analog-bassdrum'], 'spectrum') })
    await render()
    await click(addButton())
    await render({ block: addBlock(['synth'], 'vector') })
    expect(prompt()).toBeNull()
  })
  it('leaves a plain add button for stock FX2 and nothing for a module that fits or is added', async () => {
    const { render } = card({ block: addBlock([], 'spectrum', true) })
    await render()
    expect(addButton().classList.contains('is-conflict')).toBe(false)
    expect(addButton().getAttribute('aria-label')).toBe('Add Spectrum to module set')
    expect(container.querySelector('.add-block-chip')?.textContent).toBe('Needs stock FX2 off')
    await render({ block: undefined })
    expect(container.querySelector('.add-block-chip')).toBeNull()
    expect(container.querySelector('.card-bottom')?.textContent).toContain(DETAILS.spectrum.family)
    await render({ block: addBlock(['analog-bassdrum'], 'spectrum'), selected: true })
    expect(container.querySelector('.add-block-chip')).toBeNull()
    expect(addButton().getAttribute('aria-label')).toBe('Remove Spectrum from module set')
  })
})
