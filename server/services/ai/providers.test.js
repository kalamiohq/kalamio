import { describe, it, expect } from 'vitest'
import { AI_PROVIDERS, publicCatalog, isSupportedModel, validateApiKeyFormat, createLanguageModel } from './providers.js'

const KEYS = {
  gemini: 'AIza' + 'a'.repeat(35),
  openai: 'sk-proj-' + 'b'.repeat(30),
  grok: 'xai-' + 'c'.repeat(30),
  claude: 'sk-ant-api03-' + 'd'.repeat(30),
}

describe('AI provider catalog', () => {
  it('supports Gemini, OpenAI, Grok and Claude, each with models', () => {
    expect(Object.keys(AI_PROVIDERS)).toEqual(['gemini', 'openai', 'grok', 'claude'])
    for (const p of Object.values(AI_PROVIDERS)) expect(p.models.length).toBeGreaterThan(0)
  })

  it('exposes no key patterns or factories to clients', () => {
    for (const p of publicCatalog()) {
      expect(Object.keys(p).sort()).toEqual(['id', 'keyPrefix', 'keysUrl', 'models', 'name'])
    }
  })

  it('validates model ids per provider', () => {
    expect(isSupportedModel('claude', 'claude-sonnet-5-5')).toBe(true)
    expect(isSupportedModel('openai', 'claude-sonnet-5-5')).toBe(false)
    expect(isSupportedModel('nope', 'x')).toBe(false)
  })

  it('validates key formats with specific, non-echoing messages', () => {
    for (const [id, key] of Object.entries(KEYS)) expect(validateApiKeyFormat(id, key)).toBe('')
    expect(validateApiKeyFormat('openai', KEYS.claude)).toMatch(/looks like a Claude key/)
    const msg = validateApiKeyFormat('gemini', 'not-a-key-123')
    expect(msg).toMatch(/start with "AIza"/)
    expect(msg).not.toContain('not-a-key-123')
  })

  it('builds a model for every catalog entry, and only with an explicit user key', () => {
    for (const [id, p] of Object.entries(AI_PROVIDERS)) {
      const model = createLanguageModel(id, p.models[0].id, KEYS[id])
      expect(model.modelId).toBe(p.models[0].id)
    }
    // No key → refuse instead of letting the SDK fall back to a server env var.
    expect(() => createLanguageModel('openai', 'gpt-5.5', '')).toThrow()
    expect(() => createLanguageModel('openai', 'not-a-model', KEYS.openai)).toThrow()
  })
})
