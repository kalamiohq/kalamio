import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import AiSuggestion, { getAiSuggestion } from '../components/editor/extensions/AiSuggestion'
import {
  captureEditorContext, resolveTarget, applyProposal, getSections, showSuggestion, clearSuggestion,
  countNonText, describeCounts, articleText,
} from './ai-editor'

const ARTICLE = '<p>Intro text.</p><h2>Training</h2><p>Weeks of running.</p><h3>Shoes</h3><p>Good shoes.</p><h2>Race day</h2><p>It rained.</p>'

let editor
const make = (html = ARTICLE) => (editor = new Editor({ extensions: [StarterKit, Image, AiSuggestion], content: html }))
afterEach(() => editor?.destroy())

const html = () => editor.getHTML()
let seq = 0
const proposal = (operation, type, section, range = null) => ({ id: `p${++seq}`, operation, target: { type, ...(section ? { section } : {}) }, range })
/** Select the first occurrence of `text` and capture context like the sidebar does at send time. */
const selectText = (text) => {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text.includes(text)) from = pos + node.text.indexOf(text)
  })
  editor.commands.setTextSelection({ from, to: from + text.length })
  return captureEditorContext(editor).range
}
const dom = () => document.createElement('div')

describe('captureEditorContext / articleText', () => {
  it('reports the outline and the selected text', () => {
    make()
    selectText('It rained.')
    const ctx = captureEditorContext(editor)
    expect(ctx.outline).toEqual([{ text: 'Training', level: 2 }, { text: 'Shoes', level: 3 }, { text: 'Race day', level: 2 }])
    expect(ctx.selection).toEqual({ text: 'It rained.' })
  })

  it('is empty when no editor is available', () => {
    expect(captureEditorContext(null)).toEqual({ outline: [], selection: null, range: null })
  })

  it('sections span their subsections', () => {
    make()
    const [training, shoes] = getSections(editor)
    expect(editor.state.doc.textBetween(training.bodyFrom, training.to, '|')).toBe('Weeks of running.|Shoes|Good shoes.')
    expect(editor.state.doc.textBetween(shoes.bodyFrom, shoes.to, '|')).toBe('Good shoes.')
  })

  it('shows the model markers for non-text content instead of dropping it', () => {
    make('<p>Before</p><img src="https://x.io/a.png" alt="Finish line"><hr><p>After</p>')
    expect(articleText(editor)).toBe('Before\n\n[image: Finish line]\n\n[divider]\n\nAfter')
  })
})

describe('inline suggestion (review before applying)', () => {
  it('shows the proposal without changing the document, and highlights what would be removed', () => {
    make()
    const before = html()
    const p = proposal('replace', 'section', 'Race day')
    const widget = dom()
    expect(showSuggestion(editor, p, null, widget).ok).toBe(true)

    expect(html()).toBe(before) // nothing applied yet
    expect(getAiSuggestion(editor.state)).toMatchObject({ id: p.id })
    const removed = [...editor.view.dom.querySelectorAll('.ai-suggestion-remove')].map(e => e.textContent).join('')
    expect(removed).toBe('It rained.')
    expect(editor.view.dom.contains(widget)).toBe(true) // the editable preview is placed in the article
  })

  it('outlines images inside the range it would remove, and counts them for the warning', () => {
    make('<h2>Gallery</h2><p>Look:</p><img src="https://x.io/a.png"><img src="https://x.io/b.png"><hr><h2>Next</h2>')
    const p = proposal('replace', 'section', 'Gallery')
    showSuggestion(editor, p, null, dom())
    expect(editor.view.dom.querySelectorAll('.ai-suggestion-remove-node')).toHaveLength(3)
    const s = getAiSuggestion(editor.state)
    const counts = countNonText(editor.state.doc, s.from, s.to)
    expect(counts).toEqual({ image: 2, divider: 1 })
    expect(describeCounts(counts)).toBe('2 images and 1 divider')
  })

  it('follows the author\'s edits while they review, then applies at the mapped position', () => {
    make()
    const p = proposal('insert', 'after_section', 'Training')
    showSuggestion(editor, p, null, dom())
    editor.commands.insertContentAt(0, '<p>A new first paragraph.</p>') // shifts everything
    expect(applyProposal(editor, p, '<p>After training.</p>').ok).toBe(true)
    expect(html()).toContain('<p>Good shoes.</p><p>After training.</p><h2>Race day</h2>')
    expect(getAiSuggestion(editor.state)).toBeNull() // preview removed in the same step
  })

  it('becomes stale (and refuses to apply) when the text it replaces is deleted', () => {
    make()
    const range = selectText('It rained.')
    const p = proposal('replace', 'selection', null, range)
    showSuggestion(editor, p, range, dom())
    editor.commands.deleteRange({ from: range.from, to: range.to })
    expect(getAiSuggestion(editor.state).stale).toBe(true)
    const after = html()
    expect(applyProposal(editor, p, 'x').ok).toBe(false)
    expect(html()).toBe(after)
  })

  it('cancelling (clearing) leaves the article exactly as it was', () => {
    make()
    const before = html()
    const p = proposal('replace', 'entire_article')
    showSuggestion(editor, p, null, dom())
    clearSuggestion(editor, 'some-other-id') // only clears its own suggestion
    expect(getAiSuggestion(editor.state)).not.toBeNull()
    clearSuggestion(editor, p.id)
    expect(getAiSuggestion(editor.state)).toBeNull()
    expect(html()).toBe(before)
    expect(editor.view.dom.querySelector('.ai-suggestion-remove')).toBeNull()
  })

  it('applies as ONE undo step, and showing/clearing never enters history', () => {
    make()
    const before = html()
    const p = proposal('append', 'end')
    showSuggestion(editor, p, null, dom())
    applyProposal(editor, p, '<p>The end.</p>')
    expect(html()).toContain('<p>The end.</p>')
    editor.commands.undo()
    expect(html()).toBe(before)
  })
})

describe('applyProposal (each target)', () => {
  it('inserts at the start', () => {
    make()
    expect(applyProposal(editor, proposal('insert', 'start'), '<p>Hook!</p>').ok).toBe(true)
    expect(html()).toMatch(/^<p>Hook!<\/p><p>Intro text\.<\/p>/)
  })

  it('inserts at the captured cursor', () => {
    make()
    const range = selectText('Intro text.')
    applyProposal(editor, proposal('insert', 'cursor', null, { ...range, to: range.from, text: '' }), 'NEW ')
    expect(html()).toContain('<p>NEW Intro text.</p>')
  })

  it('inserts before / after a section (case-insensitive name)', () => {
    make()
    applyProposal(editor, proposal('insert', 'before_section', 'race DAY'), '<p>Before race.</p>')
    expect(html()).toContain('<p>Good shoes.</p><p>Before race.</p><h2>Race day</h2>')
    // "Training" (with its "Shoes" subsection) now ends right before "Race day".
    applyProposal(editor, proposal('insert', 'after_section', 'Training'), '<p>After training.</p>')
    expect(html()).toContain('<p>Before race.</p><p>After training.</p><h2>Race day</h2>')
  })

  it('appends to the end of the article and of a section', () => {
    make()
    applyProposal(editor, proposal('append', 'end'), '<p>The end.</p>')
    expect(html()).toMatch(/<p>It rained\.<\/p><p>The end\.<\/p>$/)
    applyProposal(editor, proposal('append', 'end_of_section', 'Shoes'), '<ul><li>Socks</li></ul>')
    expect(html()).toContain('<p>Good shoes.</p><ul><li><p>Socks</p></li></ul><h2>Race day</h2>')
  })

  it('replaces the selection, keeping formatting from the HTML', () => {
    make()
    const range = selectText('It rained.')
    applyProposal(editor, proposal('replace', 'selection', null, range), 'It <strong>poured</strong>.')
    expect(html()).toContain('<p>It <strong>poured</strong>.</p>')
  })

  it('replaces a section body but keeps its heading', () => {
    make()
    applyProposal(editor, proposal('replace', 'section', 'Race day'), '<p>Sunny and fast.</p>')
    expect(html()).toMatch(/<h2>Race day<\/h2><p>Sunny and fast\.<\/p>$/)
  })

  it('replaces the entire draft', () => {
    make()
    applyProposal(editor, proposal('replace', 'entire_article'), '<h2>Fresh</h2><p>Start.</p>')
    expect(html()).toBe('<h2>Fresh</h2><p>Start.</p>')
  })

  it('fails without editing when the target is gone or changed', () => {
    make()
    const range = selectText('It rained.')
    expect(applyProposal(editor, proposal('append', 'end_of_section', 'Nutrition'), 'x')).toEqual({ ok: false, message: expect.stringMatching(/no longer in the article/) })

    editor.commands.insertContentAt(range.from, 'Then ') // the author keeps typing
    const afterTyping = html()
    expect(applyProposal(editor, proposal('replace', 'selection', null, range), 'x').message).toMatch(/selected text has changed/)
    expect(html()).toBe(afterTyping)
    expect(applyProposal(editor, proposal('insert', 'cursor', null, { from: 99999, to: 99999, text: '' }), 'x').ok).toBe(false)
    expect(resolveTarget(editor, proposal('insert', 'cursor'), null).ok).toBe(false)
  })

  it('refuses ambiguous section names', () => {
    make('<h2>Notes</h2><p>a</p><h2>Notes</h2><p>b</p>')
    expect(applyProposal(editor, proposal('replace', 'section', 'Notes'), 'x').message).toMatch(/Several sections/)
  })

  it('reports an unavailable editor', () => {
    make()
    editor.destroy()
    expect(applyProposal(editor, proposal('append', 'end'), 'x')).toEqual({ ok: false, message: expect.stringMatching(/isn't available/) })
    expect(applyProposal(null, proposal('append', 'end'), 'x').ok).toBe(false)
  })

  it('reports execution failures instead of throwing', () => {
    make()
    const chain = vi.spyOn(editor, 'chain').mockImplementation(() => { throw new Error('boom') })
    expect(applyProposal(editor, proposal('append', 'end'), 'x')).toEqual({ ok: false, message: "The editor couldn't apply this change." })
    chain.mockRestore()
  })
})
