import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/msw/server'
import { API } from '../test/msw/handlers'

vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal()), ensureFreshToken: vi.fn() }))

import { ensureFreshToken } from './api'
import { streamAiChat, checkProposal } from './ai-chat'

// An SSE response whose body arrives in the given raw chunks (split mid-event on purpose).
const sseResponse = (...chunks) => new HttpResponse(new ReadableStream({
  start(controller) {
    const enc = new TextEncoder()
    chunks.forEach(c => controller.enqueue(enc.encode(c)))
    controller.close()
  },
}), { headers: { 'Content-Type': 'text/event-stream' } })

const BODY = { messages: [{ id: 'm1', role: 'user', content: 'hi' }], article: { title: 't', text: 'x' } }
const run = (onDelta = vi.fn(), extra = {}) => streamAiChat({ body: BODY, onDelta, ...extra })

describe('streamAiChat', () => {
  beforeEach(() => { ensureFreshToken.mockResolvedValue('token-123') })

  it('sends an authenticated request and streams deltas across chunk boundaries', async () => {
    let seen
    server.use(http.post(`${API}/ai/chat`, async ({ request }) => {
      seen = { auth: request.headers.get('authorization'), body: await request.json() }
      return sseResponse(
        'event: delta\ndata: {"text":"Hel',
        'lo"}\n\n: keep-alive\n\nevent: delta\ndata: {"text":" world"}\n\n',
        'event: done\ndata: {}\n\n',
      )
    }))
    const onDelta = vi.fn()

    await expect(run(onDelta)).resolves.toEqual({ status: 'done' })
    expect(onDelta.mock.calls.map(c => c[0])).toEqual(['Hello', ' world'])
    expect(seen.auth).toBe('Bearer token-123')
    expect(seen.body).toEqual(BODY)
  })

  it('routes context, status, notice and proposal events to their callbacks', async () => {
    const proposal = { toolCallId: 'c1', operation: 'append', target: { type: 'end' }, content: '<p>Bye</p>' }
    server.use(http.post(`${API}/ai/chat`, () => sseResponse(
      'event: context\ndata: {"summary":"- likes short posts","through":"m0"}\n\n',
      'event: status\ndata: {"message":"Drafting an article change…"}\n\n',
      'event: notice\ndata: {"message":"unusable"}\n\n',
      `event: proposal\ndata: ${JSON.stringify(proposal)}\n\n`,
      'event: done\ndata: {}\n\n',
    )))
    const cb = { onContext: vi.fn(), onStatus: vi.fn(), onNotice: vi.fn(), onProposal: vi.fn() }

    await expect(run(vi.fn(), cb)).resolves.toEqual({ status: 'done' })
    expect(cb.onContext).toHaveBeenCalledWith({ summary: '- likes short posts', through: 'm0' })
    expect(cb.onStatus).toHaveBeenCalledWith('Drafting an article change…')
    expect(cb.onNotice).toHaveBeenCalledWith('unusable')
    expect(cb.onProposal).toHaveBeenCalledWith(proposal)
  })

  it('surfaces an output-guardrail block and stops reading', async () => {
    server.use(http.post(`${API}/ai/chat`, () => sseResponse(
      'event: delta\ndata: {"text":"partial"}\n\nevent: blocked\ndata: {"message":"The response was stopped."}\n\n',
    )))
    await expect(run()).resolves.toEqual({ status: 'blocked', message: 'The response was stopped.' })
  })

  it('maps pre-stream JSON errors (input block, validation, rate limit)', async () => {
    server.use(http.post(`${API}/ai/chat`, () => HttpResponse.json({ error: 'Remove the card number.', code: 'blocked' }, { status: 422 })))
    await expect(run()).resolves.toEqual({ status: 'blocked', message: 'Remove the card number.' })

    server.use(http.post(`${API}/ai/chat`, () => HttpResponse.json({ error: 'Validation failed', details: [{ message: 'Message too long' }] }, { status: 400 })))
    await expect(run()).resolves.toEqual({ status: 'error', message: 'Message too long' })
  })

  it('treats a stream that ends without "done" as an error, and needs a session', async () => {
    server.use(http.post(`${API}/ai/chat`, () => sseResponse('event: delta\ndata: {"text":"cut"}\n\n')))
    await expect(run()).resolves.toMatchObject({ status: 'error' })

    ensureFreshToken.mockResolvedValue(null)
    await expect(run()).resolves.toMatchObject({ status: 'error', message: expect.stringMatching(/sign in/) })
  })

  it('reports an aborted request as aborted', async () => {
    server.use(http.post(`${API}/ai/chat`, () => sseResponse('event: delta\ndata: {"text":"a"}\n\n')))
    const controller = new AbortController()
    controller.abort()
    await expect(run(vi.fn(), { signal: controller.signal })).resolves.toEqual({ status: 'aborted' })
  })
})

describe('checkProposal', () => {
  it('returns the server-sanitized content to apply', async () => {
    let sent
    server.use(http.post(`${API}/ai/proposals/check`, async ({ request }) => {
      sent = await request.json()
      return HttpResponse.json({ ok: true, proposal: { ...sent.proposal, content: '<p>clean</p>' } })
    }))
    await expect(checkProposal({ operation: 'append', target: { type: 'end' }, content: '<p onclick="x">clean</p>' }))
      .resolves.toEqual({ ok: true, content: '<p>clean</p>' })
    expect(sent).toEqual({ proposal: { operation: 'append', target: { type: 'end' }, content: '<p onclick="x">clean</p>' } })
  })

  it('surfaces guardrail refusals and validation errors', async () => {
    server.use(http.post(`${API}/ai/proposals/check`, () => HttpResponse.json({ error: 'Contains sensitive data.', code: 'blocked' }, { status: 422 })))
    await expect(checkProposal({ operation: 'append', target: { type: 'end' }, content: 'x' })).resolves.toEqual({ ok: false, message: 'Contains sensitive data.' })
  })
})
