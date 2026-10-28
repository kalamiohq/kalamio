import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import AiSuggestion, { getAiSuggestion } from '../extensions/AiSuggestion'
import AiInlineSuggestion from './AiInlineSuggestion'

let editor
let mount
beforeEach(() => {
  // A real editor mounted in the page, like the article editor.
  mount = document.createElement('div')
  document.body.appendChild(mount)
  editor = new Editor({
    element: mount,
    extensions: [StarterKit, Image, AiSuggestion],
    content: '<h2>Gallery</h2><p>Old caption.</p><img src="https://x.io/a.png"><h2>End</h2>',
  })
})
afterEach(() => { editor.destroy(); mount.remove() })

const message = (target, operation = 'replace') => ({
  id: 'm1',
  proposal: { id: 'c1', operation, target, content: '<p>New caption.</p>', range: null },
  proposalState: { status: 'pending' },
})
const renderInline = (msg, extra = {}) => {
  const handlers = { onApply: vi.fn(), onCancel: vi.fn(), onUnavailable: vi.fn() }
  const view = render(<AiInlineSuggestion editor={editor} message={msg} busy={false} {...handlers} {...extra} />)
  return { ...handlers, ...view }
}

describe('AiInlineSuggestion', () => {
  it('renders the editable proposal inside the article, with removals highlighted, without changing it', () => {
    const before = editor.getHTML()
    renderInline(message({ type: 'section', section: 'Gallery' }))

    const box = screen.getByRole('textbox', { name: /AI suggestion/ })
    expect(mount.contains(box)).toBe(true) // inside the editor, not the sidebar
    expect(box).toHaveTextContent('New caption.')
    expect(mount.querySelector('.ai-suggestion-remove').textContent).toBe('Old caption.')
    expect(mount.querySelectorAll('.ai-suggestion-remove-node')).toHaveLength(1)
    expect(screen.getByText(/This also removes 1 image/)).toBeInTheDocument()
    expect(editor.getHTML()).toBe(before)
  })

  it('hands Apply / Cancel to the parent — it never edits the article itself', () => {
    const before = editor.getHTML()
    const { onApply, onCancel } = renderInline(message({ type: 'end' }, 'append'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply Changes' }))
    expect(onApply).toHaveBeenCalledWith('m1', '<p>New caption.</p>', false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledWith('m1')
    expect(editor.getHTML()).toBe(before)
  })

  it('reports a target that no longer exists instead of showing anything', () => {
    const { onUnavailable } = renderInline(message({ type: 'section', section: 'Nutrition' }))
    expect(onUnavailable).toHaveBeenCalledWith('m1', expect.stringMatching(/no longer in the article/))
    expect(screen.queryByRole('textbox', { name: /AI suggestion/ })).toBeNull()
    expect(getAiSuggestion(editor.state)).toBeNull()
  })

  it('updates live when the author deletes the content it would replace', () => {
    renderInline(message({ type: 'section', section: 'Gallery' }))
    const s = getAiSuggestion(editor.state)
    act(() => { editor.commands.deleteRange({ from: s.from, to: s.to }) })
    expect(screen.getByRole('button', { name: 'Apply Changes' })).toBeDisabled()
    expect(screen.getByText(/has been deleted/)).toBeInTheDocument()
  })

  it('removes the highlight when it goes away (resolved, reset or editor closed)', () => {
    const { unmount } = renderInline(message({ type: 'section', section: 'Gallery' }))
    expect(getAiSuggestion(editor.state)).not.toBeNull()
    unmount()
    expect(getAiSuggestion(editor.state)).toBeNull()
    expect(mount.querySelector('.ai-suggestion-remove')).toBeNull()
  })
})
