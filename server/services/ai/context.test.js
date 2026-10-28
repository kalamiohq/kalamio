import { describe, it, expect, vi } from 'vitest'

vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal()), generateText: vi.fn() }))

import { generateText } from 'ai'
import { planCompaction, summarizeIncrementally, toModelMessages, SUMMARY_MAX_CHARS } from './context.js'

let n = 0
const u = (content = 'q') => ({ id: `m${++n}`, role: 'user', content })
const a = (content = 'a', toolCall) => ({ id: `m${++n}`, role: 'assistant', content, ...(toolCall ? { toolCall } : {}) })
const t = (toolCallId, status = 'applied') => ({ id: `m${++n}`, role: 'tool', toolCallId, operation: 'append', result: { status } })

describe('planCompaction', () => {
  it('keeps everything at or under the limit', () => {
    const msgs = [u(), a(), u()]
    expect(planCompaction(msgs, 10)).toEqual({ archived: [], active: msgs })
  })

  it('keeps at most the newest 10, starting on a user message', () => {
    const msgs = Array.from({ length: 13 }, (_, i) => (i % 2 ? a() : u()))
    const { archived, active } = planCompaction(msgs, 10)
    expect(active.length).toBeLessThanOrEqual(10)
    expect(active[0].role).toBe('user')
    expect([...archived, ...active]).toEqual(msgs) // order preserved, nothing lost
  })

  it('never separates a tool call from its result', () => {
    const call = { id: 'c1', operation: 'append', target: { type: 'end' }, content: 'x' }
    const msgs = [u(), a(), u(), a(), u(), a('', call), t('c1'), u(), a(), u(), a(), u()]
    const { active } = planCompaction(msgs, 6)
    const callIdx = active.findIndex(m => m.toolCall)
    if (callIdx !== -1) expect(active[callIdx + 1]).toMatchObject({ role: 'tool', toolCallId: 'c1' })
    expect(active.some(m => m.role === 'tool') ? active.some(m => m.toolCall) : true).toBe(true)
    expect(active[0].role).toBe('user')
  })
})

describe('summarizeIncrementally', () => {
  it('sends the previous summary plus only the archived messages, and caps the result', async () => {
    generateText.mockResolvedValue({ text: 'x'.repeat(SUMMARY_MAX_CHARS + 50) })
    const call = { id: 'c1', operation: 'replace', target: { type: 'section', section: 'Intro' }, content: '<p>New <strong>intro</strong></p>' }
    const summary = await summarizeIncrementally({
      model: {}, previousSummary: '- Prefers short sentences',
      archived: [u('Make it punchier'), a('Sure', call), t('c1', 'cancelled')],
    })
    const { prompt, instructions } = generateText.mock.calls[0][0]
    expect(prompt).toContain('- Prefers short sentences')
    expect(prompt).toContain('Author: Make it punchier')
    expect(prompt).toContain('Assistant proposed to replace at section "Intro": New intro')
    expect(prompt).toContain('Result of the proposed append: cancelled')
    expect(instructions).toMatch(/preferences/)
    expect(summary).toHaveLength(SUMMARY_MAX_CHARS)
  })

  it('throws on an empty summary so the caller keeps the old one', async () => {
    generateText.mockResolvedValue({ text: '   ' })
    await expect(summarizeIncrementally({ model: {}, previousSummary: '', archived: [u()] })).rejects.toThrow()
  })
})

describe('toModelMessages', () => {
  it('maps tool calls and results to structured parts', () => {
    const call = { id: 'c1', operation: 'insert', target: { type: 'after_section', section: 'Intro' }, content: '<p>x</p>' }
    expect(toModelMessages([a('', call)])[0].content).toEqual([
      { type: 'tool-call', toolCallId: 'c1', toolName: 'insertContent', input: { location: 'after_section', section: 'Intro', content: '<p>x</p>' } },
    ])
  })
})
