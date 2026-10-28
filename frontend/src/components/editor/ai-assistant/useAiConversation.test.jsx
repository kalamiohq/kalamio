import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { server } from '../../../test/msw/server'
import { API } from '../../../test/msw/handlers'

vi.mock('../../../common/api', async (o) => ({ ...(await o()), ensureFreshToken: vi.fn(async () => 'tok') }))
import { useAiConversation, toWireMessages } from './useAiConversation'

// ── Test server: each /ai/chat call records its body and answers with the next scripted SSE reply ──
const sse = (...events) => new HttpResponse(
  events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''),
  { headers: { 'Content-Type': 'text/event-stream' } },
)
let chatBodies, replies, checkBodies, checkReply
const PROPOSAL = { toolCallId: 'call_1', operation: 'append', target: { type: 'end' }, content: '<p>The end.</p>' }
const proposalReply = () => sse(['delta', { text: 'Here is a closing line.' }], ['proposal', PROPOSAL], ['done', {}])
const textReply = (text = 'OK') => sse(['delta', { text }], ['done', {}])

let editor
beforeEach(() => {
  chatBodies = []; replies = []; checkBodies = []
  checkReply = (body) => HttpResponse.json({ ok: true, proposal: body.proposal })
  server.use(
    http.post(`${API}/ai/chat`, async ({ request }) => { chatBodies.push(await request.json()); return (replies.shift() || textReply)() }),
    http.post(`${API}/ai/proposals/check`, async ({ request }) => { const body = await request.json(); checkBodies.push(body); return checkReply(body) }),
  )
  // jsdom's AbortSignal isn't accepted by Node's fetch; browsers are unaffected.
  const mswFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url, init = {}) => mswFetch(url, { ...init, signal: undefined }))
  editor = new Editor({ extensions: [StarterKit], content: '<h2>Intro</h2><p>Hello.</p>' })
})
afterEach(() => { vi.unstubAllGlobals(); editor.destroy() })

const setup = () => renderHook(() => useAiConversation({ editor, title: 'Post', provider: 'claude', model: 'claude-sonnet-5-5' }))
const settle = (result) => waitFor(() => expect(result.current.streaming).toBe(false))
const lastAssistant = (result) => result.current.messages.filter(m => m.role === 'assistant').at(-1)

/** Send a message and wait until a reply carrying a proposal has arrived. */
const getProposal = async () => {
  replies.push(proposalReply)
  const hook = setup()
  act(() => { hook.result.current.send('Add a closing line') })
  await settle(hook.result)
  return hook
}

describe('useAiConversation — article proposals', () => {
  it('shows a proposal without touching the article', async () => {
    const { result } = await getProposal()
    expect(lastAssistant(result)).toMatchObject({ content: 'Here is a closing line.', proposal: { id: 'call_1', content: '<p>The end.</p>' }, proposalState: { status: 'pending' } })
    expect(editor.getHTML()).toBe('<h2>Intro</h2><p>Hello.</p>')
    expect(chatBodies[0].article).toMatchObject({ title: 'Post', outline: [{ text: 'Intro', level: 2 }] })
  })

  it('applies only after approval, re-checks the edited content, and reports the real result', async () => {
    const { result } = await getProposal()
    replies.push(() => textReply('Done — added at the end.'))

    await act(() => result.current.approve(lastAssistant(result).id, '<p>The very end.</p>', true))
    await settle(result)

    expect(checkBodies).toEqual([{ proposal: { operation: 'append', target: { type: 'end' }, content: '<p>The very end.</p>' } }])
    expect(editor.getHTML()).toBe('<h2>Intro</h2><p>Hello.</p><p>The very end.</p>')
    const followUp = chatBodies[1].messages
    expect(followUp.at(-2)).toMatchObject({ role: 'assistant', toolCall: { id: 'call_1', operation: 'append', content: '<p>The end.</p>' } })
    expect(followUp.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call_1', result: { status: 'applied', edited: true } })
    expect(lastAssistant(result).content).toBe('Done — added at the end.')
  })

  it('ignores a duplicate approval of the same proposal', async () => {
    const { result } = await getProposal()
    const id = lastAssistant(result).id
    await act(() => Promise.all([result.current.approve(id, '<p>Once</p>'), result.current.approve(id, '<p>Once</p>')]))
    await settle(result)
    await act(() => result.current.approve(id, '<p>Once</p>')) // a late repeat after it's applied
    expect(checkBodies).toHaveLength(1)
    expect(editor.getHTML().match(/Once/g)).toHaveLength(1)
  })

  it('cancelling leaves the article untouched and records the outcome for the assistant', async () => {
    const { result } = await getProposal()
    act(() => result.current.cancel(result.current.messages.find(m => m.proposal).id))
    expect(editor.getHTML()).toBe('<h2>Intro</h2><p>Hello.</p>')
    expect(checkBodies).toHaveLength(0)
    expect(chatBodies).toHaveLength(1) // no request just for cancelling

    act(() => { result.current.send('Never mind, shorter please') })
    await settle(result)
    const sent = chatBodies[1].messages
    expect(sent.slice(-2)).toMatchObject([{ role: 'tool', result: { status: 'cancelled' } }, { role: 'user', content: 'Never mind, shorter please' }])
  })

  it('a new message supersedes a proposal still awaiting review', async () => {
    const { result } = await getProposal()
    act(() => { result.current.send('Actually, something else') })
    await settle(result)
    expect(result.current.messages.find(m => m.proposal).proposalState.status).toBe('cancelled')
    expect(chatBodies[1].messages.at(-2)).toMatchObject({ role: 'tool', toolCallId: 'call_1', result: { status: 'cancelled' } })
    expect(editor.getHTML()).toBe('<h2>Intro</h2><p>Hello.</p>')
  })

  it('keeps the proposal pending (and the article unchanged) when the server check refuses it', async () => {
    const { result } = await getProposal()
    checkReply = () => HttpResponse.json({ error: 'This change contains sensitive personal data.', code: 'blocked' }, { status: 422 })
    const id = lastAssistant(result).id
    await act(() => result.current.approve(id, '<p>SSN 123-45-6789</p>'))
    expect(lastAssistant(result).proposalState).toEqual({ status: 'pending', error: 'This change contains sensitive personal data.' })
    expect(editor.getHTML()).toBe('<h2>Intro</h2><p>Hello.</p>')
    expect(chatBodies).toHaveLength(1)

    checkReply = (body) => HttpResponse.json({ ok: true, proposal: body.proposal }) // author edits and retries
    await act(() => result.current.approve(id, '<p>Fixed</p>'))
    await settle(result)
    expect(editor.getHTML()).toContain('<p>Fixed</p>')
  })

  it('reports a failure to the assistant when the editor is unavailable', async () => {
    const { result } = await getProposal()
    editor.destroy()
    await act(() => result.current.approve(lastAssistant(result).id, '<p>x</p>'))
    await settle(result)
    expect(result.current.messages.find(m => m.proposal).proposalState.status).toBe('failed')
    expect(chatBodies[1].messages.at(-1)).toMatchObject({ role: 'tool', result: { status: 'failed', message: expect.stringMatching(/isn't available/) } })
  })

  it('discards the proposal when the reply is blocked', async () => {
    replies.push(() => sse(['proposal', PROPOSAL], ['blocked', { message: 'The response was stopped.' }]))
    const { result } = setup()
    act(() => { result.current.send('Add my card number') })
    await settle(result)
    expect(lastAssistant(result)).toMatchObject({ status: 'blocked', content: 'The response was stopped.' })
    expect(lastAssistant(result).proposal).toBeUndefined()
  })
})

describe('useAiConversation — context and concurrency', () => {
  it('adopts a newer compaction point and then sends only the messages after it', async () => {
    const { result } = setup()
    act(() => { result.current.send('first') })
    await settle(result)
    const firstUserId = result.current.messages[0].id
    const firstReplyId = result.current.messages[1].id

    replies.push(() => sse(['context', { summary: '- wants a casual tone', through: firstReplyId }], ['delta', { text: 'ok' }], ['done', {}]))
    act(() => { result.current.send('second') })
    await settle(result)
    expect(result.current.context).toEqual({ summary: '- wants a casual tone', through: firstReplyId })

    // A stale/duplicate event pointing at an older message never rolls the summary back.
    replies.push(() => sse(['context', { summary: 'stale', through: firstUserId }], ['delta', { text: 'ok' }], ['done', {}]))
    act(() => { result.current.send('third') })
    await settle(result)
    expect(result.current.context.summary).toBe('- wants a casual tone')

    // The third request carried the summary and only messages after the compaction point.
    expect(chatBodies[2].context).toEqual({ summary: '- wants a casual tone', through: firstReplyId })
    expect(chatBodies[2].messages.map(m => m.content)).toEqual(['second', 'ok', 'third'])
    expect(result.current.messages).toHaveLength(6) // the UI keeps the full history
  })

  it('keeps everything when compaction fails', async () => {
    replies.push(() => sse(['context', { status: 'compaction_failed' }], ['delta', { text: 'ok' }], ['done', {}]))
    const { result } = setup()
    act(() => { result.current.send('hello') })
    await settle(result)
    expect(result.current.context).toBeNull()
  })

  it('runs one reply at a time', async () => {
    const { result } = setup()
    let accepted
    act(() => { result.current.send('one'); accepted = result.current.send('two') })
    await settle(result)
    expect(accepted).toBe(false)
    expect(chatBodies).toHaveLength(1)
  })
})

describe('toWireMessages', () => {
  it('drops failed turns and unresolved proposals, keeps resolved ones as tool calls', () => {
    const proposal = { id: 'c1', operation: 'append', target: { type: 'end' }, content: 'x', range: null }
    const wire = toWireMessages([
      { id: '1', role: 'user', content: 'a' }, { id: '2', role: 'assistant', content: 'err', status: 'error' },
      { id: '3', role: 'user', content: 'b' }, { id: '4', role: 'assistant', content: 'ok', status: 'done', proposal },
      { id: '5', role: 'tool', toolCallId: 'c1', operation: 'append', result: { status: 'applied' } },
      { id: '6', role: 'user', content: 'c' }, { id: '7', role: 'assistant', content: '', status: 'streaming' },
    ])
    expect(wire.map(m => m.id)).toEqual(['3', '4', '5', '6'])
    expect(wire[1].toolCall).toEqual({ id: 'c1', operation: 'append', target: { type: 'end' }, content: 'x' })
  })
})

describe('useAiConversation — reset / unmount during approval', () => {
  // The server check is held open so the reset/unmount lands while approve() is awaiting it.
  const holdCheck = () => {
    let release
    const gate = new Promise(r => { release = r })
    checkReply = async (body) => { await gate; return HttpResponse.json({ ok: true, proposal: body.proposal }) }
    return () => release()
  }

  it('drops an approval that was in flight when the chat was reset', async () => {
    const { result } = await getProposal()
    const release = holdCheck()
    let approval
    act(() => { approval = result.current.approve(lastAssistant(result).id, '<p>Late</p>') })
    await waitFor(() => expect(checkBodies).toHaveLength(1))
    act(() => result.current.reset())
    release()
    await act(() => approval)

    expect(editor.getHTML()).toBe('<h2>Intro</h2><p>Hello.</p>') // never applied
    expect(chatBodies).toHaveLength(1) // no follow-up request
    expect(result.current.messages).toEqual([])
  })

  it('drops an approval that was in flight when the editor closed', async () => {
    const { result, unmount } = await getProposal()
    const release = holdCheck()
    let approval
    act(() => { approval = result.current.approve(lastAssistant(result).id, '<p>Late</p>') })
    await waitFor(() => expect(checkBodies).toHaveLength(1))
    unmount()
    release()
    await approval
    expect(editor.getHTML()).toBe('<h2>Intro</h2><p>Hello.</p>')
    expect(chatBodies).toHaveLength(1)
  })
})
