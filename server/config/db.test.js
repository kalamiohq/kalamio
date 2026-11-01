import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logServerLoss } from './db.js'

describe('logServerLoss', () => {
  let client
  let warn

  beforeEach(() => {
    client = new EventEmitter()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logServerLoss(client)
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('logs the address and the reason when a server goes Unknown', () => {
    client.emit('serverDescriptionChanged', {
      address: 'db-0:27017',
      newDescription: { type: 'Unknown', error: new Error('connection <monitor> to 10.0.0.1:27017 closed') },
    })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('db-0:27017')
    expect(warn.mock.calls[0][0]).toContain('connection <monitor> to 10.0.0.1:27017 closed')
  })

  it('stays quiet while a server is healthy', () => {
    client.emit('serverDescriptionChanged', {
      address: 'db-0:27017',
      newDescription: { type: 'RSPrimary', error: null },
    })

    expect(warn).not.toHaveBeenCalled()
  })

  it('stays quiet for an Unknown server with no error, as on first discovery', () => {
    client.emit('serverDescriptionChanged', {
      address: 'db-0:27017',
      newDescription: { type: 'Unknown', error: null },
    })

    expect(warn).not.toHaveBeenCalled()
  })
})
