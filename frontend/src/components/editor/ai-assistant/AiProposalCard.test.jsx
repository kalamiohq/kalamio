import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import AiProposalCard from './AiProposalCard'

const PENDING = { status: 'pending' }
const proposal = (operation, type, extra = {}) => ({ id: 'c1', operation, target: { type, ...extra }, content: '<p>Proposed text</p>' })
const renderCard = (props) => {
  const handlers = { onApply: vi.fn(), onCancel: vi.fn() }
  render(<AiProposalCard state={PENDING} resolved={{ ok: true }} {...props} {...handlers} />)
  return handlers
}
const apply = () => screen.getByRole('button', { name: 'Apply Changes' })
// The preview is a real TipTap editor; drive it through its API (jsdom can't type into contenteditable).
const previewEditor = () => document.querySelector('.ProseMirror').editor

describe('AiProposalCard', () => {
  it('shows the operation, location and editable proposed content', () => {
    renderCard({ proposal: proposal('insert', 'after_section', { section: 'Training' }) })
    expect(screen.getByRole('heading', { name: 'Proposed change: Insert' })).toBeInTheDocument()
    expect(screen.getByText('After the section “Training”')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveTextContent('Proposed text')
    expect(previewEditor().isEditable).toBe(true)
  })

  it('applies only on an explicit click, with the author\'s edits', () => {
    const { onApply, onCancel } = renderCard({ proposal: proposal('append', 'end') })
    expect(onApply).not.toHaveBeenCalled() // rendering a proposal never applies it
    act(() => { previewEditor().commands.setContent('<p>My edited text</p>', true) })
    fireEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith('<p>My edited text</p>', true)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('passes edited=false when the proposal is applied as-is', () => {
    const { onApply } = renderCard({ proposal: proposal('append', 'end') })
    fireEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith('<p>Proposed text</p>', false)
  })

  it('cancels without applying', () => {
    const { onApply, onCancel } = renderCard({ proposal: proposal('append', 'end') })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('blocks applying empty content', () => {
    renderCard({ proposal: proposal('append', 'end') })
    act(() => { previewEditor().commands.clearContent(true) })
    expect(apply()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Add some content, or cancel.')
  })

  it('shows the content being replaced next to the replacement', () => {
    renderCard({ proposal: proposal('replace', 'section', { section: 'Race day' }), resolved: { ok: true, existingText: 'It rained.' } })
    expect(screen.getByText('Current content')).toBeInTheDocument()
    expect(screen.getByText('It rained.')).toBeInTheDocument()
    expect(screen.getByText(/Replacement/)).toBeInTheDocument()
  })

  it('requires explicit confirmation to replace the entire draft', () => {
    const { onApply } = renderCard({ proposal: proposal('replace', 'entire_article'), resolved: { ok: true, existingText: 'Old draft' } })
    expect(screen.getByRole('heading', { name: 'Replace entire draft' })).toBeInTheDocument()
    expect(apply()).toBeDisabled()
    fireEvent.click(apply())
    expect(onApply).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this replaces my entire draft.' }))
    expect(apply()).toBeEnabled()
    fireEvent.click(apply())
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('cannot apply when the target no longer resolves, or while another reply streams', () => {
    renderCard({ proposal: proposal('replace', 'selection'), resolved: { ok: false, error: 'The selected text has changed since you asked.' } })
    expect(apply()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('The selected text has changed')
  })

  it('disables applying while busy and shows final states without actions', () => {
    const { rerender } = render(<AiProposalCard proposal={proposal('append', 'end')} state={PENDING} resolved={{ ok: true }} busy onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(apply()).toBeDisabled()
    rerender(<AiProposalCard proposal={proposal('append', 'end')} state={{ status: 'applied' }} resolved={{ ok: true }} onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull()
    expect(screen.getByText(/Applied to your article/)).toBeInTheDocument()
    expect(previewEditor().isEditable).toBe(false)
  })
})
