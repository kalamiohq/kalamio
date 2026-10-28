import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import { encryptApiKey, decryptApiKey, isKeyEncryptionConfigured } from './key-crypto.js'

const KEY = 'sk-ant-api03-' + 'x'.repeat(40)

describe('AI key encryption (AES-256-GCM)', () => {
  let saved
  beforeEach(() => {
    saved = process.env.AI_KEY_ENCRYPTION_KEY
    process.env.AI_KEY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
  })
  afterEach(() => { process.env.AI_KEY_ENCRYPTION_KEY = saved })

  it('round-trips, and never stores the plaintext', () => {
    const payload = encryptApiKey(KEY, 'user-1')
    expect(payload.startsWith('v1.')).toBe(true)
    expect(payload).not.toContain(KEY)
    expect(decryptApiKey(payload, 'user-1')).toBe(KEY)
    // Fresh IV every time.
    expect(encryptApiKey(KEY, 'user-1')).not.toBe(payload)
  })

  it('refuses another user, a tampered payload, or a different server key', () => {
    const payload = encryptApiKey(KEY, 'user-1')
    expect(() => decryptApiKey(payload, 'user-2')).toThrow()

    const parts = payload.split('.')
    const ct = Buffer.from(parts[3], 'base64url'); ct[0] ^= 1
    expect(() => decryptApiKey([...parts.slice(0, 3), ct.toString('base64url')].join('.'), 'user-1')).toThrow()

    process.env.AI_KEY_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
    expect(() => decryptApiKey(payload, 'user-1')).toThrow()
  })

  it('reports itself unconfigured for a missing or wrong-length key', () => {
    process.env.AI_KEY_ENCRYPTION_KEY = ''
    expect(isKeyEncryptionConfigured()).toBe(false)
    expect(() => encryptApiKey(KEY, 'u')).toThrow(/AI_KEY_ENCRYPTION_KEY/)
    process.env.AI_KEY_ENCRYPTION_KEY = crypto.randomBytes(16).toString('base64')
    expect(isKeyEncryptionConfigured()).toBe(false)
  })
})
