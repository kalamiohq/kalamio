import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

// Full route pipeline (auth → per-user rate limit → body parser → Zod → controller → SSE) with the
// database and the model calls mocked. Guardrails run for real (local PII check; no moderation key).
vi.mock('../Schema/User.js', () => ({ default: { findById: vi.fn(), findByIdAndUpdate: vi.fn() } }))
vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal()), streamText: vi.fn(), generateText: vi.fn() }))

import User from '../Schema/User.js'
import { streamText, generateText, APICallError } from 'ai'
import aiRoutes from './ai.routes.js'
import { encryptApiKey, decryptApiKey } from '../services/ai/key-crypto.js'

const CLAUDE_KEY = 'sk-ant-api03-' + 'k'.repeat(40)
// Mirrors server.js: a tight global JSON parser that skips the AI routes with their own limits.
const OWN_PARSER = new Set(['/api/v1/ai/chat', '/api/v1/ai/proposals/check'])
const globalJson = express.json({ limit: '10kb' })
const app = express()
  .use((req, res, next) => (OWN_PARSER.has(req.path) ? next() : globalJson(req, res, next)))
  .use('/api/v1', aiRoutes)

let userSeq = 0
const newUser = () => `user-${++userSeq}` // fresh id per test → fresh rate-limit bucket
const auth = (userId) => `Bearer ${jwt.sign({ id: userId }, process.env.JWT_ACCESS_SECRET)}`
// Each test user gets its own client IP (read from CF-Connecting-IP, as behind Cloudflare), so the
// per-IP apiLimiter in front of auth doesn't leak between tests. The rate-limit tests use the default IP.
const ipFor = (userId) => `10.0.${Math.floor(Number(userId.split('-')[1]) / 250)}.${Number(userId.split('-')[1]) % 250}`

// User.findById(...).select(...).lean() → { ai_settings }
const mockAiSettings = (ai_settings) => {
  User.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ _id: 'x', ai_settings }) }) })
}
const connectedClaude = (userId) => ({
  active_provider: 'claude',
  providers: [{ provider: 'claude', model: 'claude-sonnet-5-5', key_ciphertext: encryptApiKey(CLAUDE_KEY, userId), key_last4: CLAUDE_KEY.slice(-4) }],
})
/** A connected user, ready to chat. */
const readyUser = () => { const id = newUser(); mockAiSettings(connectedClaude(id)); return id }

// streamText(...) → { fullStream } yielding the given parts.
const mockModelStream = (...parts) => {
  streamText.mockReturnValue({ fullStream: (async function* () { yield* parts })() })
}
const delta = (text) => ({ type: 'text-delta', id: '1', text })
const toolCall = (toolName, input, toolCallId = 'call_1') => ({ type: 'tool-call', toolCallId, toolName, input })

// Parse an SSE body into [{ event, data }].
const parseSse = (body) => body.split('\n\n').filter(b => b.startsWith('event:')).map(block => {
  const [eventLine, dataLine] = block.split('\n')
  return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) }
})
const eventsOf = async (res) => parseSse((await res).text)

const chat = (userId, body) => request(app).post('/api/v1/ai/chat').set('Authorization', auth(userId)).set('CF-Connecting-IP', ipFor(userId)).send(body)
let msgSeq = 0
const user = (content) => ({ id: `m${++msgSeq}`, role: 'user', content })
const assistant = (content, extra = {}) => ({ id: `m${++msgSeq}`, role: 'assistant', content, ...extra })
const userMsg = (content) => ({ messages: [user(content)] })

const ARTICLE = {
  title: 'My first marathon',
  text: 'Intro\nTraining\nWeeks of running.\nRace day\nIt rained.',
  outline: [{ text: 'Training', level: 2 }, { text: 'Race day', level: 2 }],
  selection: { text: 'It rained.' },
}

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret'
  process.env.AI_KEY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
  delete process.env.OPENAI_MODERATION_API_KEY
})
beforeEach(() => { User.findByIdAndUpdate.mockResolvedValue({}) })

describe('AI settings', () => {
  it('stores the key encrypted and only ever returns the last 4 characters', async () => {
    const userId = newUser()
    mockAiSettings(undefined)

    const res = await request(app).post('/api/v1/ai/settings/update').set('Authorization', auth(userId)).set('CF-Connecting-IP', ipFor(userId))
      .send({ provider: 'claude', model: 'claude-opus-5-5', apiKey: `  ${CLAUDE_KEY}  ` })

    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain(CLAUDE_KEY.slice(0, 20))
    expect(res.body).toMatchObject({ enabled: true, active_provider: 'claude', providers: [{ provider: 'claude', model: 'claude-opus-5-5', key_last4: 'kkkk' }] })
    expect(res.body.providers[0]).not.toHaveProperty('key_ciphertext')

    const saved = User.findByIdAndUpdate.mock.calls[0][1].$set.ai_settings.providers[0]
    expect(saved.key_ciphertext).not.toContain(CLAUDE_KEY)
    expect(decryptApiKey(saved.key_ciphertext, userId)).toBe(CLAUDE_KEY) // trimmed, bound to this user
  })

  it('rejects a malformed or wrong-provider key without echoing it', async () => {
    mockAiSettings(undefined)
    const res = await request(app).post('/api/v1/ai/settings/update').set('Authorization', auth(newUser()))
      .send({ provider: 'openai', model: 'gpt-5.5', apiKey: CLAUDE_KEY })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/looks like a Claude key/)
    expect(JSON.stringify(res.body)).not.toContain(CLAUDE_KEY)
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled()
  })

  it('switches model without re-sending the key, and removes keys', async () => {
    const userId = newUser()
    mockAiSettings(connectedClaude(userId))
    const switched = await request(app).post('/api/v1/ai/settings/update').set('Authorization', auth(userId)).set('CF-Connecting-IP', ipFor(userId))
      .send({ provider: 'claude', model: 'claude-haiku-5-5' })
    expect(switched.body.providers[0]).toMatchObject({ model: 'claude-haiku-5-5', key_last4: 'kkkk' })

    const removed = await request(app).post('/api/v1/ai/settings/remove').set('Authorization', auth(userId)).set('CF-Connecting-IP', ipFor(userId)).send({ provider: 'claude' })
    expect(removed.body).toMatchObject({ active_provider: null, providers: [] })
  })

  it('rejects unsupported providers/models and unauthenticated calls', async () => {
    const bad = await request(app).post('/api/v1/ai/settings/update').set('Authorization', auth(newUser()))
      .send({ provider: 'claude', model: 'gpt-5.5', apiKey: CLAUDE_KEY })
    expect(bad.status).toBe(400)
    expect((await request(app).post('/api/v1/ai/settings').send({})).status).toBe(401)
  })
})

describe('AI chat — streaming and guardrails', () => {
  it('streams the reply as SSE deltas and passes the article as reference context', async () => {
    const userId = readyUser()
    mockModelStream(delta('Try: '), delta('"Ten Lessons '), delta('From a Marathon"'))

    const res = await chat(userId, { ...userMsg('Suggest a title'), article: ARTICLE })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    expect(res.headers['x-accel-buffering']).toBe('no')
    const events = parseSse(res.text)
    expect(events.filter(e => e.event === 'delta').map(e => e.data.text).join('')).toBe('Try: "Ten Lessons From a Marathon"')
    expect(events.at(-1)).toEqual({ event: 'done', data: {} })

    const call = streamText.mock.calls[0][0]
    expect(call.messages).toEqual([{ role: 'user', content: 'Suggest a title' }])
    expect(call.instructions).toContain('<article>')
    expect(call.instructions).toContain('- Training')
    expect(call.instructions).toContain('<selection>\nIt rained.')
    expect(call.model.modelId).toBe('claude-sonnet-5-5')
    expect(Object.keys(call.tools)).toEqual(['insertContent', 'appendContent', 'replaceContent', 'editText'])
    expect(Object.values(call.tools).every(t => !t.execute)).toBe(true) // tools can never act on their own
    expect(typeof call.onError).toBe('function') // replaces the SDK default, which logs the prompt
  })

  it('streams long replies progressively, in more than one delta', async () => {
    const userId = readyUser()
    mockModelStream(...Array.from({ length: 30 }, () => delta('A sentence of reasonable length. ')))
    const events = await eventsOf(chat(userId, userMsg('Write more')))
    expect(events.filter(e => e.event === 'delta').length).toBeGreaterThan(1)
  })

  it('blocks a prompt with high-risk personal data before calling the model', async () => {
    const userId = readyUser()
    const res = await chat(userId, userMsg('Rewrite this: my card is 4111 1111 1111 1111'))
    expect(res.status).toBe(422)
    expect(res.body.code).toBe('blocked')
    expect(res.body.error).not.toContain('4111')
    expect(streamText).not.toHaveBeenCalled()
  })

  it('applies the input checks to the client-held summary too', async () => {
    const userId = readyUser()
    const res = await chat(userId, { ...userMsg('Continue'), context: { summary: '- Author SSN is 123-45-6789', through: 'old-1' } })
    expect(res.status).toBe(422)
    expect(streamText).not.toHaveBeenCalled()
  })

  it('stops a reply that trips the output guardrail, without sending the unsafe text', async () => {
    const userId = readyUser()
    mockModelStream(delta('Here is an example SSN: '), delta('123-45-6789'), delta(' for your story.'))

    const events = await eventsOf(chat(userId, userMsg('Give me an example')))
    expect(events.at(-1).event).toBe('blocked')
    expect(JSON.stringify(events)).not.toContain('123-45-6789')
    expect(events.some(e => e.event === 'done')).toBe(false)
  })

  it('reports provider failures with safe copy — no key, prompt or provider message', async () => {
    const userId = readyUser()
    const providerError = new APICallError({
      message: `invalid x-api-key ${CLAUDE_KEY}`, url: 'https://api.anthropic.com/v1/messages',
      requestBodyValues: { messages: [{ role: 'user', content: 'secret draft' }] }, statusCode: 401,
    })
    mockModelStream({ type: 'error', error: providerError })

    const res = await chat(userId, userMsg('secret draft'))
    const events = parseSse(res.text)
    expect(events.at(-1)).toEqual({ event: 'error', data: { message: 'Claude rejected your API key. Update it in the assistant settings.' } })
    expect(res.text).not.toContain(CLAUDE_KEY)
    expect(res.text).not.toContain('invalid x-api-key')
  })

  it('validates the payload: supported provider/model, ids, message order', async () => {
    const userId = readyUser()
    expect((await chat(userId, { provider: 'llama', model: 'x', ...userMsg('hi') })).status).toBe(400)
    expect((await chat(userId, { provider: 'claude', model: 'gpt-5.5', ...userMsg('hi') })).status).toBe(400)
    expect((await chat(userId, { messages: [{ role: 'user', content: 'no id' }] })).status).toBe(400)
    expect((await chat(userId, { messages: [user('hi'), assistant('hello')] })).status).toBe(400) // must end on user/tool
    expect((await chat(userId, { messages: [assistant('hello'), user('hi')] })).status).toBe(400) // must start on user
    const dup = user('a')
    expect((await chat(userId, { messages: [dup, assistant('b'), { ...dup }] })).status).toBe(400)
    expect((await chat(userId, { messages: [] })).status).toBe(400)
    expect(streamText).not.toHaveBeenCalled()
  })

  it('asks the user to connect a provider first', async () => {
    mockAiSettings(undefined)
    const res = await chat(newUser(), userMsg('hi'))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('not_configured')
  })

  it('rate-limits per user', async () => {
    const userId = newUser()
    mockAiSettings(undefined) // cheapest path through the controller
    const statuses = []
    for (let i = 0; i < 11; i++) statuses.push((await chat(userId, userMsg('hi'))).status)
    expect(statuses.slice(0, 10).every(s => s === 400)).toBe(true)
    expect(statuses[10]).toBe(429)
    expect((await chat(newUser(), userMsg('hi'))).status).toBe(400) // another user is unaffected
  })

  it('caps concurrent streams per user, and frees the slot when a stream ends', async () => {
    const userId = readyUser()
    let finish
    const gate = new Promise(r => { finish = r })
    streamText.mockImplementation(() => ({ fullStream: (async function* () { await gate; yield delta('ok') })() }))

    const first = chat(userId, userMsg('one')).then(r => r)
    const second = chat(userId, userMsg('two')).then(r => r)
    await vi.waitFor(() => expect(streamText).toHaveBeenCalledTimes(2))

    const third = await chat(userId, userMsg('three'))
    expect(third.status).toBe(429)
    expect(third.body.code).toBe('too_many_streams')

    finish()
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    expect((await chat(userId, userMsg('four'))).status).toBe(200)
  })
})

describe('AI chat — article edit proposals', () => {
  it('turns a valid tool call into a sanitized proposal, never streaming tool content early', async () => {
    const userId = readyUser()
    mockModelStream(
      delta('Here is a closing paragraph.'),
      { type: 'tool-input-start', id: 'call_1', toolName: 'appendContent' },
      toolCall('appendContent', { location: 'end', content: '<p>Thanks for <strong>reading</strong>!</p><script>alert(1)</script>' }),
    )

    const events = await eventsOf(chat(userId, { ...userMsg('Add a closing line to the article'), article: ARTICLE }))
    expect(events.map(e => e.event)).toEqual(['delta', 'status', 'proposal', 'done'])
    expect(events[2].data).toEqual({
      toolCallId: 'call_1', operation: 'append', target: { type: 'end' },
      content: '<p>Thanks for <strong>reading</strong>!</p>',
    })
    expect(JSON.stringify(events)).not.toContain('script')
  })

  it.each([
    ['insertContent', { location: 'after_section', section: 'training', content: 'New para' }, { operation: 'insert', target: { type: 'after_section', section: 'Training' } }],
    ['insertContent', { location: 'cursor', content: 'At the caret' }, { operation: 'insert', target: { type: 'cursor' } }],
    ['appendContent', { location: 'end_of_section', section: 'Race day', content: 'More' }, { operation: 'append', target: { type: 'end_of_section', section: 'Race day' } }],
    ['replaceContent', { target: 'selection', content: 'It poured.' }, { operation: 'replace', target: { type: 'selection' } }],
    ['replaceContent', { target: 'entire_article', section: 'ignored', content: 'All new' }, { operation: 'replace', target: { type: 'entire_article' } }],
  ])('accepts %s %j', async (toolName, input, expected) => {
    const userId = readyUser()
    mockModelStream(toolCall(toolName, input))
    const proposal = (await eventsOf(chat(userId, { ...userMsg('Change the article'), article: ARTICLE }))).find(e => e.event === 'proposal')
    expect(proposal?.data).toMatchObject(expected)
  })

  it.each([
    ['insertContent', { location: 'after_section', section: 'Nope', content: 'x' }, /section it named isn't in the article/],
    ['insertContent', { location: 'end', content: 'x' }, /isn't a valid location for insert/],
    ['appendContent', { location: 'end_of_section', content: 'x' }, /section heading is required/],
    ['replaceContent', { target: 'section', section: 'Training', content: '<script>x</script>' }, /empty/],
    ['replaceContent', { target: 'everything', content: 'x' }, /./],
    ['deleteArticle', { target: 'entire_article' }, /unknown editing tool/],
  ])('rejects %s %j with a notice instead of a proposal', async (toolName, input, error) => {
    const userId = readyUser()
    mockModelStream(delta('Sure.'), toolCall(toolName, input))
    const events = await eventsOf(chat(userId, { ...userMsg('Change the article'), article: ARTICLE }))
    expect(events.some(e => e.event === 'proposal')).toBe(false)
    expect(events.find(e => e.event === 'notice').data.message).toMatch(error)
    expect(events.at(-1).event).toBe('done')
  })

  it('refuses selection replacement when nothing is selected', async () => {
    const userId = readyUser()
    mockModelStream(toolCall('replaceContent', { target: 'selection', content: 'x' }))
    const events = await eventsOf(chat(userId, { ...userMsg('Rewrite my selection'), article: { ...ARTICLE, selection: { text: '' } } }))
    expect(events.find(e => e.event === 'notice').data.message).toMatch(/Nothing is selected/)
  })

  it('blocks a proposal whose content trips the output guardrail', async () => {
    const userId = readyUser()
    mockModelStream(toolCall('appendContent', { location: 'end', content: '<p>Card: 4111 1111 1111 1111</p>' }))
    const events = await eventsOf(chat(userId, { ...userMsg('Add my card'), article: ARTICLE }))
    expect(events.map(e => e.event)).toEqual(['blocked'])
    expect(JSON.stringify(events)).not.toContain('4111')
  })

  it('offers only one proposal per reply', async () => {
    const userId = readyUser()
    mockModelStream(
      toolCall('appendContent', { location: 'end', content: 'one' }, 'call_1'),
      toolCall('appendContent', { location: 'end', content: 'two' }, 'call_2'),
    )
    const events = await eventsOf(chat(userId, { ...userMsg('Add two things'), article: ARTICLE }))
    expect(events.filter(e => e.event === 'proposal').map(e => e.data.toolCallId)).toEqual(['call_1'])
  })

  it('replays a resolved proposal to the model as structured tool-call/result parts', async () => {
    const userId = readyUser()
    mockModelStream(delta('Done — I added it at the end.'))
    const messages = [
      user('Add a closing line'),
      assistant('Here you go.', { toolCall: { id: 'call_9', operation: 'append', target: { type: 'end' }, content: '<p>Bye</p>' } }),
      { id: 'm-tool', role: 'tool', toolCallId: 'call_9', operation: 'append', result: { status: 'applied', edited: true } },
    ]
    expect((await chat(userId, { messages, article: ARTICLE })).status).toBe(200)

    const sent = streamText.mock.calls[0][0].messages
    expect(sent[1]).toEqual({ role: 'assistant', content: [
      { type: 'text', text: 'Here you go.' },
      { type: 'tool-call', toolCallId: 'call_9', toolName: 'appendContent', input: { location: 'end', content: '<p>Bye</p>' } },
    ] })
    expect(sent[2]).toEqual({ role: 'tool', content: [
      { type: 'tool-result', toolCallId: 'call_9', toolName: 'appendContent', output: { type: 'json', value: { status: 'applied', edited: true } } },
    ] })
  })

  it('rejects history where a proposal has no result, or a result has no proposal', async () => {
    const userId = readyUser()
    const unresolved = [user('a'), assistant('b', { toolCall: { id: 'c1', operation: 'append', target: { type: 'end' }, content: 'x' } }), user('c')]
    expect((await chat(userId, { messages: unresolved })).status).toBe(400)
    const orphan = [user('a'), { id: 't1', role: 'tool', toolCallId: 'c1', operation: 'append', result: { status: 'applied' } }]
    expect((await chat(userId, { messages: orphan })).status).toBe(400)
  })
})

describe('AI chat — context compaction', () => {
  // 12 alternating messages: u a u a … u — more than the 10-message active window.
  const longConversation = () => Array.from({ length: 11 }, (_, i) => (i % 2 ? assistant(`answer ${i}`) : user(`question ${i}`)))

  it('folds older messages into the summary once the active context exceeds 10 messages', async () => {
    const userId = readyUser()
    generateText.mockResolvedValue({ text: '- Author wants a casual tone\n- Article is about a marathon' })
    mockModelStream(delta('ok'))
    const messages = [...longConversation(), user('latest')]

    const events = await eventsOf(chat(userId, { messages, context: { summary: '- Prefers British spelling', through: 'm0' } }))

    // Incremental: previous summary + ONLY the newly archived messages go to the summarizer.
    const prompt = generateText.mock.calls[0][0].prompt
    expect(prompt).toContain('- Prefers British spelling')
    expect(prompt).toContain('Author: question 0')
    expect(prompt).not.toContain('latest')

    const contextEvent = events.find(e => e.event === 'context')
    const sent = streamText.mock.calls[0][0]
    expect(sent.messages.length).toBeLessThanOrEqual(10)
    expect(sent.messages[0].role).toBe('user')
    expect(contextEvent.data.summary).toContain('casual tone')
    // `through` is the last archived message: everything after it is exactly what was sent.
    const throughIndex = messages.findIndex(m => m.id === contextEvent.data.through)
    expect(messages.length - throughIndex - 1).toBe(sent.messages.length)
    expect(sent.instructions).toContain('<conversation_summary>\n- Author wants a casual tone')
    expect(events.map(e => e.event)).toEqual(['context', 'delta', 'done'])
  })

  it('does not summarize at or under the limit', async () => {
    const userId = readyUser()
    mockModelStream(delta('ok'))
    const messages = longConversation().slice(0, 9).concat(user('q')) // 10 messages
    await eventsOf(chat(userId, { messages }))
    expect(generateText).not.toHaveBeenCalled()
    expect(streamText.mock.calls[0][0].messages).toHaveLength(10)
  })

  it('keeps the previous summary and every message when summarization fails', async () => {
    const userId = readyUser()
    generateText.mockRejectedValue(new APICallError({ message: 'overloaded', url: 'x', requestBodyValues: {}, statusCode: 529 }))
    mockModelStream(delta('still answering'))
    const messages = [...longConversation(), user('latest')]

    const events = await eventsOf(chat(userId, { messages, context: { summary: '- Prefers British spelling', through: 'm0' } }))

    expect(events[0]).toEqual({ event: 'context', data: { status: 'compaction_failed' } })
    const sent = streamText.mock.calls[0][0]
    expect(sent.messages).toHaveLength(messages.length) // nothing dropped
    expect(sent.instructions).toContain('- Prefers British spelling') // old summary kept
    expect(events.at(-1).event).toBe('done')
  })

  it('treats a summary that fails the output guardrail as a failed compaction', async () => {
    const userId = readyUser()
    generateText.mockResolvedValue({ text: '- Author SSN 123-45-6789' })
    mockModelStream(delta('ok'))
    const events = await eventsOf(chat(userId, { messages: [...longConversation(), user('latest')] }))
    expect(events[0].data).toEqual({ status: 'compaction_failed' })
    expect(JSON.stringify(events)).not.toContain('123-45-6789')
  })
})

describe('AI proposal check (before applying)', () => {
  const check = (userId, proposal) => request(app).post('/api/v1/ai/proposals/check').set('Authorization', auth(userId)).set('CF-Connecting-IP', ipFor(userId)).send({ proposal })

  it('returns sanitized content for a valid, edited proposal', async () => {
    const res = await check(newUser(), { operation: 'replace', target: { type: 'section', section: 'Training' }, content: '<p onclick="x()">Edited <a href="javascript:alert(1)">link</a></p>' })
    expect(res.status).toBe(200)
    expect(res.body.proposal).toEqual({ operation: 'replace', target: { type: 'section', section: 'Training' }, content: '<p>Edited <a>link</a></p>' })
  })

  it('rejects invalid operations/targets, empty content and blocked content', async () => {
    const userId = newUser()
    expect((await check(userId, { operation: 'insert', target: { type: 'end' }, content: 'x' })).status).toBe(400)
    expect((await check(userId, { operation: 'replace', target: { type: 'section' }, content: 'x' })).status).toBe(400)
    expect((await check(userId, { operation: 'delete', target: { type: 'entire_article' }, content: 'x' })).status).toBe(400)
    expect((await check(userId, { operation: 'append', target: { type: 'end' }, content: '<img src=x>' })).body.code).toBe('empty')

    const blocked = await check(userId, { operation: 'append', target: { type: 'end' }, content: 'SSN 123-45-6789' })
    expect(blocked.status).toBe(422)
    expect(blocked.body.code).toBe('blocked')
    expect(blocked.body.error).not.toContain('123-45-6789')
  })

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/ai/proposals/check').send({ proposal: { operation: 'append', target: { type: 'end' }, content: 'x' } })
    expect(res.status).toBe(401)
  })
})

describe('AI settings rate limit', () => {
  it('throttles the settings routes per IP, before authentication', async () => {
    mockAiSettings(undefined)
    let last
    // Unauthenticated requests still count — the limiter runs before verifyJWT.
    for (let i = 0; i < 101; i++) last = await request(app).post('/api/v1/ai/settings').send({})
    expect(last.status).toBe(429)
    expect((await request(app).post('/api/v1/ai/settings/update').set('Authorization', auth(newUser())).send({})).status).toBe(429)
  })
})

describe('AI chat — precise text fixes (editText)', () => {
  const SPELLING = { ...ARTICLE, text: 'Tasks are too uneliable to run inline, such some cases need evn more care.' }

  it('proposes only the fixes whose text is really in the article', async () => {
    const userId = readyUser()
    mockModelStream(delta('Fixing the spelling.'), toolCall('editText', { edits: [
      { find: 'too uneliable to', replace: 'too unreliable to' },
      { find: 'evn more', replace: 'even more' },
      { find: 'not in the article', replace: 'x' },
    ] }))
    const events = await eventsOf(chat(userId, { ...userMsg('Fix the spelling'), article: SPELLING }))
    expect(events.find(e => e.event === 'proposal').data).toEqual({
      toolCallId: 'call_1', operation: 'edit', target: { type: 'text' },
      edits: [{ find: 'too uneliable to', replace: 'too unreliable to' }, { find: 'evn more', replace: 'even more' }],
    })
  })

  it('never matches mid-word, and rejects no-op or multi-paragraph fixes', async () => {
    const userId = readyUser()
    // "such s" only occurs inside "such some" → not a whole-word match → nothing to fix.
    mockModelStream(toolCall('editText', { edits: [{ find: 'such s', replace: 'such as' }] }))
    let events = await eventsOf(chat(userId, { ...userMsg('Fix it'), article: SPELLING }))
    expect(events.find(e => e.event === 'notice').data.message).toMatch(/None of the text/)

    mockModelStream(toolCall('editText', { edits: [{ find: 'evn', replace: 'evn' }] }))
    events = await eventsOf(chat(userId, { ...userMsg('Fix it'), article: SPELLING }))
    expect(events.find(e => e.event === 'notice').data.message).toMatch(/must change the text/)

    mockModelStream(toolCall('editText', { edits: [{ find: 'evn\nmore', replace: 'even more' }] }))
    events = await eventsOf(chat(userId, { ...userMsg('Fix it'), article: SPELLING }))
    expect(events.find(e => e.event === 'notice').data.message).toMatch(/within one paragraph/)
  })

  it('checks approved fixes on apply, and replays them to the model as an editText call', async () => {
    const userId = readyUser()
    const check = await request(app).post('/api/v1/ai/proposals/check').set('Authorization', auth(userId)).set('CF-Connecting-IP', ipFor(userId))
      .send({ proposal: { operation: 'edit', target: { type: 'text' }, edits: [{ find: 'evn', replace: 'even' }] } })
    expect(check.body.proposal.edits).toEqual([{ find: 'evn', replace: 'even' }])
    const blocked = await request(app).post('/api/v1/ai/proposals/check').set('Authorization', auth(userId)).set('CF-Connecting-IP', ipFor(userId))
      .send({ proposal: { operation: 'edit', target: { type: 'text' }, edits: [{ find: 'x', replace: 'SSN 123-45-6789' }] } })
    expect(blocked.status).toBe(422)

    mockModelStream(delta('Done.'))
    const messages = [
      user('Fix spelling'),
      assistant('Two fixes.', { toolCall: { id: 'call_7', operation: 'edit', target: { type: 'text' }, edits: [{ find: 'evn', replace: 'even' }] } }),
      { id: 'm-t', role: 'tool', toolCallId: 'call_7', operation: 'edit', result: { status: 'applied' } },
    ]
    expect((await chat(userId, { messages, article: SPELLING })).status).toBe(200)
    expect(streamText.mock.calls[0][0].messages[1].content[1]).toEqual(
      { type: 'tool-call', toolCallId: 'call_7', toolName: 'editText', input: { edits: [{ find: 'evn', replace: 'even' }] } })
  })
})

describe('AI chat — input guardrails cover the whole conversation', () => {
  it('blocks when an EARLIER message has high-risk data, even if the latest is harmless', async () => {
    const userId = readyUser()
    const messages = [user('My SSN is 123-45-6789, keep it in mind'), assistant('Noted.'), user('Now suggest a title')]
    const res = await chat(userId, { messages })
    expect(res.status).toBe(422)
    expect(res.body.error).not.toContain('123-45-6789')
    expect(streamText).not.toHaveBeenCalled()
  })

  it('screens messages that would be summarized before the summarizer ever sees them', async () => {
    const userId = readyUser()
    const messages = [user('Card 4111 1111 1111 1111'), ...Array.from({ length: 12 }, (_, i) => (i % 2 ? user(`q${i}`) : assistant(`a${i}`)))]
    expect((await chat(userId, { messages })).status).toBe(422)
    expect(generateText).not.toHaveBeenCalled()
    expect(streamText).not.toHaveBeenCalled()
  })

  it('also screens proposal content echoed back in history', async () => {
    const userId = readyUser()
    const messages = [
      user('Add a line'),
      assistant('Sure.', { toolCall: { id: 'c1', operation: 'append', target: { type: 'end' }, content: '<p>SSN 123-45-6789</p>' } }),
      { id: 'mt', role: 'tool', toolCallId: 'c1', operation: 'append', result: { status: 'cancelled' } },
      user('ok'),
    ]
    expect((await chat(userId, { messages })).status).toBe(422)
  })
})

describe('AI chat / proposal check rate limit before auth', () => {
  it('throttles requests per IP before checking the token', async () => {
    // The per-IP bucket is shared with earlier tests in this file, so just drive it past 100.
    let last
    for (let i = 0; i < 101 && last?.status !== 429; i++) last = await request(app).post('/api/v1/ai/chat').send({})
    expect(last.status).toBe(429) // unauthenticated, yet limited — never reached verifyJWT's 401
    expect((await request(app).post('/api/v1/ai/proposals/check').send({})).status).toBe(429)
  })
})

describe('AI chat — everything sent to the provider is screened', () => {
  it('screens `find` and section names in replayed tool calls, not just what they add', async () => {
    const userId = readyUser()
    const viaFind = [
      user('Fix it'),
      assistant('Fixed.', { toolCall: { id: 'c1', operation: 'edit', target: { type: 'text' }, edits: [{ find: 'SSN 123-45-6789', replace: 'SSN redacted' }] } }),
      { id: 't1', role: 'tool', toolCallId: 'c1', operation: 'edit', result: { status: 'applied' } },
      user('thanks'),
    ]
    expect((await chat(userId, { messages: viaFind })).status).toBe(422)

    const viaSection = [
      user('Add a line'),
      assistant('Sure.', { toolCall: { id: 'c2', operation: 'append', target: { type: 'end_of_section', section: 'Card 4111 1111 1111 1111' }, content: '<p>ok</p>' } }),
      { id: 't2', role: 'tool', toolCallId: 'c2', operation: 'append', result: { status: 'cancelled' } },
      user('thanks'),
    ]
    expect((await chat(userId, { messages: viaSection })).status).toBe(422)
    expect(streamText).not.toHaveBeenCalled()
  })

  it.each([
    ['body', { text: 'My SSN is 123-45-6789.' }],
    ['title', { title: 'Card 4111 1111 1111 1111' }],
    ['outline', { outline: [{ text: 'SSN 123-45-6789', level: 2 }] }],
    ['selection', { selection: { text: 'SSN 123-45-6789' } }],
  ])('refuses to send an article whose %s holds high-risk data', async (_, fields) => {
    const userId = readyUser()
    const res = await chat(userId, { ...userMsg('Suggest a title'), article: { ...ARTICLE, ...fields } })
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ code: 'blocked', source: 'article' })
    expect(res.body.error).toMatch(/Your article contains sensitive personal data/)
    expect(res.body.error).not.toMatch(/123-45-6789|4111/)
    expect(streamText).not.toHaveBeenCalled()
  })

  it('does not echo model-written section names in notices', async () => {
    const userId = readyUser()
    mockModelStream(toolCall('insertContent', { location: 'after_section', section: 'Call 555-0100 now', content: 'x' }))
    const events = await eventsOf(chat(userId, { ...userMsg('Add'), article: ARTICLE }))
    expect(events.find(e => e.event === 'notice').data.message).not.toContain('555-0100')
  })
})
