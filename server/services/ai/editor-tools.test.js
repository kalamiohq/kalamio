import { describe, it, expect } from 'vitest'
import { toolCallToProposal, finalizeProposal, sanitizeProposalHtml, htmlToText, proposalToToolInput } from './editor-tools.js'

const article = { outline: [{ text: 'Intro', level: 2 }, { text: 'Results', level: 3 }], selection: { text: 'old words' } }

describe('editor tool arguments', () => {
  it.each([
    ['insertContent', { location: 'start', content: 'a' }],
    ['insertContent', { location: 'cursor', content: 'a' }],
    ['insertContent', { location: 'before_section', section: 'Intro', content: 'a' }],
    ['insertContent', { location: 'after_section', section: 'RESULTS', content: 'a' }],
    ['appendContent', { location: 'end', content: 'a' }],
    ['appendContent', { location: 'end_of_section', section: 'Intro', content: 'a' }],
    ['replaceContent', { target: 'selection', content: 'a' }],
    ['replaceContent', { target: 'section', section: 'Intro', content: 'a' }],
    ['replaceContent', { target: 'entire_article', content: 'a' }],
  ])('accepts %s %j', (tool, input) => {
    const result = toolCallToProposal(tool, input, article)
    expect(result.ok).toBe(true)
    // Round-trips back to the same tool input shape for history replay.
    expect(proposalToToolInput(result.proposal)).toMatchObject({ ...input, content: '<p>a</p>', ...(input.section ? { section: result.proposal.target.section } : {}) })
  })

  it.each([
    ['insertContent', { location: 'end', content: 'a' }],                    // append-only location
    ['insertContent', { location: 'after_section', content: 'a' }],          // section missing
    ['insertContent', { location: 'after_section', section: 'Nope', content: 'a' }],
    ['appendContent', { location: 'start', content: 'a' }],
    ['appendContent', { location: 'end', content: '' }],
    ['replaceContent', { target: 'section', section: 'Intro', content: 'x'.repeat(20001) }],
    ['replaceContent', { target: 'selection', content: 'a' }, { ...article, selection: { text: ' ' } }],
    ['insertContent', { location: 'cursor', content: 'a' }, { ...article, selection: null }],
    ['replaceContent', { target: 'entire_article', content: '<style>p{}</style>' }],
    ['runJavaScript', { code: 'alert(1)' }],
    ['appendContent', null],
  ])('rejects %s %j', (tool, input, art = article) => {
    expect(toolCallToProposal(tool, input, art).ok).toBe(false)
  })

  it('normalizes section names to the article heading', () => {
    expect(finalizeProposal({ operation: 'append', target: { type: 'end_of_section', section: ' results ' }, content: 'x' }, article).proposal.target.section).toBe('Results')
  })
})

describe('content sanitizing', () => {
  it('keeps supported formatting and strips everything else', () => {
    expect(sanitizeProposalHtml('<h1>T</h1><p style="x">a <b>b</b> <a href="javascript:x">c</a> <a href="https://k.io" target="_blank">d</a></p><iframe src="x"></iframe><img src=x>'))
      .toBe('<h2>T</h2><p>a <strong>b</strong> <a>c</a> <a href="https://k.io">d</a></p>')
  })

  it('turns plain text into escaped paragraphs', () => {
    expect(sanitizeProposalHtml('One <two>\nline\n\nThree')).toBe('<p>One &lt;two&gt;<br />line</p><p>Three</p>')
  })

  it('detects markup the same way on normal input', () => {
    expect(sanitizeProposalHtml('<img src=x>')).toBe('')                       // tag with attributes → sanitized away
    expect(sanitizeProposalHtml('use <title> here')).toBe('<p>use &lt;title&gt; here</p>') // prose stays text
    expect(sanitizeProposalHtml('a < b and c > d')).toBe('<p>a &lt; b and c &gt; d</p>')
    expect(sanitizeProposalHtml('<p>hi</p>')).toBe('<p>hi</p>')
  })

  it.each([
    ['"<a" + 19990 tabs', '<a' + '\t'.repeat(19990)],
    ['"<a\\t" × 6660', '<a\t'.repeat(6660)],
    ['"<p" + 19990 spaces', '<p' + ' '.repeat(19990)],
    ['"<x " + 19990 "a"s', '<x ' + 'a'.repeat(19990)],
  ])('stays linear on hostile input at the 20k limit (%s)', (_, input) => {
    const start = performance.now()
    sanitizeProposalHtml(input)
    // The quadratic regex took ~300–450 ms here; linear is well under 1 ms (+ sanitizer time).
    expect(performance.now() - start).toBeLessThan(100)
  })

  it('extracts readable text for the guardrails', () => {
    expect(htmlToText('<p>Tom &amp; Jerry</p><ul><li>a</li><li>b</li></ul>')).toBe('Tom & Jerry\na\nb')
  })
})
