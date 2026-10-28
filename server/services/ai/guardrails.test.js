import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stand-in OpenAI client for the Moderation check; the PII check runs for real (local regex).
const moderationsCreate = vi.fn()
// A plain class, not vi.fn: the server config's `mockReset` would wipe a vi.fn constructor between tests.
vi.mock('openai', () => ({
  default: class OpenAI { moderations = { create: moderationsCreate }; baseURL = 'https://api.openai.com/v1' },
}))

import { checkInput, checkOutput, GUARDRAIL_TIMEOUT_MS } from './guardrails.js'

const flagged = (category) => ({ results: [{ flagged: true, categories: { [category]: true } }] })
const clean = { results: [{ flagged: false, categories: {} }] }

describe('AI guardrails', () => {
  let saved
  beforeEach(() => { saved = process.env.OPENAI_MODERATION_API_KEY; delete process.env.OPENAI_MODERATION_API_KEY })
  afterEach(() => { process.env.OPENAI_MODERATION_API_KEY = saved })

  it('allows normal writing requests, including names, emails, numbers and URLs', async () => {
    await expect(checkInput('Tighten the intro. Quote Jane Doe (jane@example.com), cite https://example.com and the 1428627663 figure.'))
      .resolves.toEqual({ ok: true })
  })

  it('blocks high-risk identifiers on input and output', async () => {
    await expect(checkInput('My card is 4111 1111 1111 1111, rewrite this')).resolves.toEqual({ ok: false, reason: 'pii' })
    await expect(checkOutput('Sure, use SSN 123-45-6789 for the example')).resolves.toEqual({ ok: false, reason: 'pii' })
  })

  it('skips Moderation without a server moderation key', async () => {
    await checkInput('hello')
    expect(moderationsCreate).not.toHaveBeenCalled()
  })

  it('runs Moderation with the server key and blocks severe categories only', async () => {
    process.env.OPENAI_MODERATION_API_KEY = 'sk-moderation-test'
    moderationsCreate.mockResolvedValueOnce(flagged('hate/threatening'))
    await expect(checkInput('...')).resolves.toEqual({ ok: false, reason: 'moderation' })

    // Plain "violence" is common in legitimate writing (history, news) and isn't blocked.
    moderationsCreate.mockResolvedValueOnce(flagged('violence'))
    await expect(checkOutput('The battle of Hastings...')).resolves.toEqual({ ok: true })

    moderationsCreate.mockResolvedValueOnce(clean)
    await expect(checkInput('hi')).resolves.toEqual({ ok: true })
  })

  it('fails closed with a distinct reason when a check times out', async () => {
    process.env.OPENAI_MODERATION_API_KEY = 'sk-moderation-test'
    moderationsCreate.mockReturnValueOnce(new Promise(() => {})) // never settles
    vi.useFakeTimers()
    try {
      const verdict = checkOutput('hello')
      await vi.advanceTimersByTimeAsync(GUARDRAIL_TIMEOUT_MS + 1)
      await expect(verdict).resolves.toEqual({ ok: false, reason: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed when a check cannot run', async () => {
    process.env.OPENAI_MODERATION_API_KEY = 'sk-moderation-test'
    moderationsCreate.mockRejectedValueOnce(Object.assign(new Error('upstream down'), { status: 500 }))
    vi.spyOn(console, 'warn').mockImplementation(() => {}) // the package warns on execution failures
    await expect(checkInput('hello')).resolves.toEqual({ ok: false, reason: 'unavailable' })
  })
})
