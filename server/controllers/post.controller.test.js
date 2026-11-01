import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../Schema/Post.js', () => ({ default: { findOne: vi.fn() } }))
vi.mock('../config/s3.js', () => ({ deleteMultipleFromS3: vi.fn() }))

import Post from '../Schema/Post.js'
import { getPostActivity } from './post.controller.js'

const mockRes = () => {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

// findOne(...).select(...).lean() → resolves to `doc`; returns the select spy for assertions.
const mockFindOne = (doc) => {
  const select = vi.fn(() => ({ lean: vi.fn(() => Promise.resolve(doc)) }))
  Post.findOne.mockReturnValue({ select })
  return select
}

describe('getPostActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the counts and the poll tally', async () => {
    const poll = { options: [{ text: 'Yes', votes: 2 }], total_votes: 2 }
    mockFindOne({ activity: { total_likes: 5, total_comments: 3 }, poll })
    const res = mockRes()

    await getPostActivity({ body: { blog_id: 'my-post' } }, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ activity: { total_likes: 5, total_comments: 3 }, poll })
  })

  it('reads only published posts, and only the numbers it returns', async () => {
    const select = mockFindOne({ activity: { total_likes: 0, total_comments: 0 } })

    await getPostActivity({ body: { blog_id: 'my-post' } }, mockRes())

    expect(Post.findOne).toHaveBeenCalledWith({ blog_id: { $eq: 'my-post' }, draft: false })
    expect(select).toHaveBeenCalledWith('activity.total_likes activity.total_comments poll')
  })

  it('returns 404 for a missing post or a draft', async () => {
    mockFindOne(null)
    const res = mockRes()

    await getPostActivity({ body: { blog_id: 'a-draft' } }, res)

    expect(res.status).toHaveBeenCalledWith(404)
  })
})
