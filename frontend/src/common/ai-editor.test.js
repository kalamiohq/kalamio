import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { captureEditorContext, resolveTarget, applyProposal, getSections } from './ai-editor'

const ARTICLE = '<p>Intro text.</p><h2>Training</h2><p>Weeks of running.</p><h3>Shoes</h3><p>Good shoes.</p><h2>Race day</h2><p>It rained.</p>'

let editor
const make = (html = ARTICLE) => (editor = new Editor({ extensions: [StarterKit], content: html }))
afterEach(() => editor?.destroy())

const html = () => editor.getHTML()
const proposal = (operation, type, section) => ({ operation, target: { type, ...(section ? { section } : {}) } })
/** Select the first occurrence of `text` and capture context like the sidebar does at send time. */
const selectText = (text) => {
  let from = -1
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text.includes(text)) from = pos + node.text.indexOf(text)
  })
  editor.commands.setTextSelection({ from, to: from + text.length })
  return captureEditorContext(editor).range
}

describe('captureEditorContext', () => {
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
})

describe('applyProposal', () => {
  it('inserts at the start', () => {
    make()
    expect(applyProposal(editor, proposal('insert', 'start'), null, '<p>Hook!</p>').ok).toBe(true)
    expect(html()).toMatch(/^<p>Hook!<\/p><p>Intro text\.<\/p>/)
  })

  it('inserts at the captured cursor', () => {
    make()
    const range = selectText('Intro text.')
    const cursor = { ...range, to: range.from, text: '' }
    applyProposal(editor, proposal('insert', 'cursor'), cursor, 'NEW ')
    expect(html()).toContain('<p>NEW Intro text.</p>')
  })

  it('inserts before / after a section (case-insensitive name)', () => {
    make()
    applyProposal(editor, proposal('insert', 'before_section', 'race DAY'), null, '<p>Before race.</p>')
    expect(html()).toContain('<p>Good shoes.</p><p>Before race.</p><h2>Race day</h2>')
    // "Training" (with its "Shoes" subsection) now ends right before "Race day".
    applyProposal(editor, proposal('insert', 'after_section', 'Training'), null, '<p>After training.</p>')
    expect(html()).toContain('<p>Before race.</p><p>After training.</p><h2>Race day</h2>')
  })

  it('appends to the end of the article and of a section', () => {
    make()
    applyProposal(editor, proposal('append', 'end'), null, '<p>The end.</p>')
    expect(html()).toMatch(/<p>It rained\.<\/p><p>The end\.<\/p>$/)
    applyProposal(editor, proposal('append', 'end_of_section', 'Shoes'), null, '<ul><li>Socks</li></ul>')
    expect(html()).toContain('<p>Good shoes.</p><ul><li><p>Socks</p></li></ul><h2>Race day</h2>')
  })

  it('replaces the selection, keeping formatting from the HTML', () => {
    make()
    const range = selectText('It rained.')
    expect(resolveTarget(editor, proposal('replace', 'selection'), range).existingText).toBe('It rained.')
    applyProposal(editor, proposal('replace', 'selection'), range, 'It <strong>poured</strong>.')
    expect(html()).toContain('<p>It <strong>poured</strong>.</p>')
  })

  it('replaces a section body but keeps its heading', () => {
    make()
    expect(resolveTarget(editor, proposal('replace', 'section', 'Race day')).existingText).toBe('It rained.')
    applyProposal(editor, proposal('replace', 'section', 'Race day'), null, '<p>Sunny and fast.</p>')
    expect(html()).toMatch(/<h2>Race day<\/h2><p>Sunny and fast\.<\/p>$/)
  })

  it('replaces the entire draft', () => {
    make()
    applyProposal(editor, proposal('replace', 'entire_article'), null, '<h2>Fresh</h2><p>Start.</p>')
    expect(html()).toBe('<h2>Fresh</h2><p>Start.</p>')
  })

  it('fails without editing when the target is gone or changed', () => {
    make()
    const range = selectText('It rained.')
    const before = html()
    expect(applyProposal(editor, proposal('append', 'end_of_section', 'Nutrition'), null, 'x')).toEqual({ ok: false, message: expect.stringMatching(/no longer in the article/) })

    editor.commands.insertContentAt(range.from, 'Then ') // the author keeps typing
    const afterTyping = html()
    expect(applyProposal(editor, proposal('replace', 'selection'), range, 'x').message).toMatch(/selected text has changed/)
    expect(html()).toBe(afterTyping)
    expect(before).not.toBe(afterTyping)

    expect(applyProposal(editor, proposal('insert', 'cursor'), { from: 99999, to: 99999, text: '' }, 'x').ok).toBe(false)
  })

  it('refuses ambiguous section names', () => {
    make('<h2>Notes</h2><p>a</p><h2>Notes</h2><p>b</p>')
    expect(applyProposal(editor, proposal('replace', 'section', 'Notes'), null, 'x').message).toMatch(/Several sections/)
  })

  it('reports an unavailable editor', () => {
    make()
    editor.destroy()
    expect(applyProposal(editor, proposal('append', 'end'), null, 'x')).toEqual({ ok: false, message: expect.stringMatching(/isn't available/) })
    expect(applyProposal(null, proposal('append', 'end'), null, 'x').ok).toBe(false)
  })

  it('reports execution failures instead of throwing', () => {
    make()
    // `commands` is a getter returning a fresh object each time, so stub the getter.
    const commands = vi.spyOn(editor, 'commands', 'get')
    commands.mockReturnValue({ insertContentAt: () => { throw new Error('boom') } })
    expect(applyProposal(editor, proposal('append', 'end'), null, 'x')).toEqual({ ok: false, message: "The editor couldn't apply this change." })
    commands.mockReturnValue({ insertContentAt: () => false })
    expect(applyProposal(editor, proposal('append', 'end'), null, 'x').ok).toBe(false)
    commands.mockRestore()
  })
})
