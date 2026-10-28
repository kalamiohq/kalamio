import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import AiProposalCard from './AiProposalCard'

const PENDING = { status: 'pending' }
const NO_REMOVAL = { stale: false, counts: {} }
const proposal = (operation, type, extra = {}) => ({ id: 'c1', operation, target: { type, ...extra }, content: '<p>Proposed text</p>' })
const renderCard = (props) => {
  const handlers = { onApply: vi.fn(), onCancel: vi.fn() }
  render(<AiProposalCard state={PENDING} removal={NO_REMOVAL} {...props} {...handlers} />)
  return handlers
}
const apply = () => screen.getByRole('button', { name: 'Apply Changes' })
// The green preview is a real TipTap editor; drive it through its API (jsdom can't type into contenteditable).
const previewEditor = () => document.querySelector('.ProseMirror').editor

describe('AiProposalCard (inline review)', () => {
  it('shows the operation, location and the proposed content as editable green text', () => {
    renderCard({ proposal: proposal('insert', 'after_section', { section: 'Training' }) })
    expect(screen.getByText('AI suggestion')).toBeInTheDocument()
    expect(screen.getByText('Insert')).toBeInTheDocument()
    expect(screen.getByText('· After the section “Training”')).toBeInTheDocument()
    const box = screen.getByRole('textbox')
    expect(box).toHaveTextContent('Proposed text')
    expect(box).toHaveClass('ai-suggestion-insert')
    expect(previewEditor().isEditable).toBe(true)
  })

  it("applies only on an explicit click, with the author's edits", () => {
    const { onApply, onCancel } = renderCard({ proposal: proposal('append', 'end') })
    expect(onApply).not.toHaveBeenCalled() // showing a proposal never applies it
    act(() => { previewEditor().commands.setContent('<p>My edited text</p>', true) })
    fireEvent.click(apply())
    expect(onApply).toHaveBeenCalledWith('<p>My edited text</p>', true)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('passes edited=false when applied as-is', () => {
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

  it('points at the red highlight for replacements, and warns about media it would remove', () => {
    renderCard({ proposal: proposal('replace', 'section', { section: 'Gallery' }), removal: { stale: false, counts: { image: 2, table: 1 } } })
    expect(screen.getByText('The text highlighted in red above will be replaced.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This also removes 2 images and 1 table (outlined in red).')
    expect(apply()).toBeEnabled() // a warning, not a block — undo works
  })

  it('requires explicit confirmation to replace the entire draft', () => {
    const { onApply } = renderCard({ proposal: proposal('replace', 'entire_article') })
    expect(screen.getByText('Replace entire draft')).toBeInTheDocument()
    expect(apply()).toBeDisabled()
    fireEvent.click(apply())
    expect(onApply).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand this replaces my entire draft.' }))
    expect(apply()).toBeEnabled()
    fireEvent.click(apply())
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('cannot apply once the text it replaces was deleted', () => {
    renderCard({ proposal: proposal('replace', 'selection'), removal: { stale: true, counts: {} } })
    expect(apply()).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('has been deleted')
  })

  it('disables applying while busy and shows final states without actions', () => {
    const p = proposal('append', 'end')
    const { rerender } = render(<AiProposalCard proposal={p} state={PENDING} removal={NO_REMOVAL} busy onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(apply()).toBeDisabled()
    rerender(<AiProposalCard proposal={p} state={{ status: 'applied' }} removal={NO_REMOVAL} onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Apply Changes' })).toBeNull()
    expect(screen.getByText(/Applied\. Undo with Ctrl\+Z/)).toBeInTheDocument()
    expect(previewEditor().isEditable).toBe(false)
  })
})
