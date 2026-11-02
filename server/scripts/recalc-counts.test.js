import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { connectMock, countDocumentsMock, userFindMock, userUpdateMock, publicationFindMock, publicationUpdateMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  countDocumentsMock: vi.fn(),
  userFindMock: vi.fn(),
  userUpdateMock: vi.fn(),
  publicationFindMock: vi.fn(),
  publicationUpdateMock: vi.fn(),
}))

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}))

vi.mock('mongoose', () => ({
  default: { connect: connectMock },
}))

vi.mock('../Schema/Post.js', () => ({
  default: { countDocuments: countDocumentsMock },
}))

vi.mock('../Schema/User.js', () => ({
  default: { find: userFindMock, updateOne: userUpdateMock },
}))

vi.mock('../Schema/Publication.js', () => ({
  default: { find: publicationFindMock, updateOne: publicationUpdateMock },
}))

describe('recalc-counts command', () => {
  let exitSpy
  let errorSpy

  beforeEach(() => {
    vi.resetModules()
    connectMock.mockReset().mockResolvedValue()
    countDocumentsMock.mockReset()
    userFindMock.mockReset().mockResolvedValue([])
    userUpdateMock.mockReset().mockResolvedValue()
    publicationFindMock.mockReset().mockResolvedValue([])
    publicationUpdateMock.mockReset().mockResolvedValue()
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function runCommand() {
    await import('./recalc-counts.js')
  }

  it('recounts user and publication totals and exits successfully', async () => {
    userFindMock.mockResolvedValue([{
      _id: 'user-id',
      personal_info: { username: 'ada' },
      account_info: { total_posts: 0 },
    }])
    publicationFindMock.mockResolvedValue([{ _id: 'publication-id', title: 'Science', total_posts: 0 }])
    countDocumentsMock.mockResolvedValueOnce(2).mockResolvedValueOnce(3)

    await runCommand()
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0))

    expect(countDocumentsMock).toHaveBeenNthCalledWith(1, {
      author: 'user-id',
      draft: false,
      type: { $ne: 'text_post' },
    })
    expect(countDocumentsMock).toHaveBeenNthCalledWith(2, {
      publication: 'publication-id',
      draft: false,
      type: { $ne: 'text_post' },
    })
    expect(userUpdateMock).toHaveBeenCalledWith(
      { _id: 'user-id' },
      { $set: { 'account_info.total_posts': 2 } },
    )
    expect(publicationUpdateMock).toHaveBeenCalledWith(
      { _id: 'publication-id' },
      { $set: { total_posts: 3 } },
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('logs a database connection failure', async () => {
    const error = new Error('database unavailable')
    connectMock.mockRejectedValue(error)

    await runCommand()
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(error))

    expect(userFindMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('logs a database query failure', async () => {
    const error = new Error('count query failed')
    userFindMock.mockResolvedValue([{
      _id: 'user-id',
      personal_info: { username: 'ada' },
      account_info: { total_posts: 0 },
    }])
    countDocumentsMock.mockRejectedValue(error)

    await runCommand()
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(error))

    expect(userUpdateMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('logs a user update failure', async () => {
    const error = new Error('user update failed')
    userFindMock.mockResolvedValue([{
      _id: 'user-id',
      personal_info: { username: 'ada' },
      account_info: { total_posts: 0 },
    }])
    countDocumentsMock.mockResolvedValue(2)
    userUpdateMock.mockRejectedValue(error)

    await runCommand()
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(error))

    expect(publicationFindMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
