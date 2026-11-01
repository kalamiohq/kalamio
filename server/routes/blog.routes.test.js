import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

// The /blog-activity route pipeline (rate limit → auth → Zod → controller) with the database mocked.
vi.mock('../Schema/Post.js', () => ({ default: { findOne: vi.fn() } }))
// The real Blog and TextPost models call Post.discriminator() on import.
vi.mock('../Schema/Blog.js', () => ({ default: {} }))
vi.mock('../Schema/TextPost.js', () => ({ default: {} }))
vi.mock('../config/s3.js', () => ({ deleteMultipleFromS3: vi.fn() }))

import Post from '../Schema/Post.js'
import blogRoutes from './blog.routes.js'

const app = express().use(express.json()).use('/api/v1', blogRoutes)

const post = (body, { ip = '10.1.0.1', token } = {}) => {
  const req = request(app).post('/api/v1/blog-activity').set('CF-Connecting-IP', ip)
  if (token) req.set('Authorization', `Bearer ${token}`)
  return req.send(body)
}

describe('POST /blog-activity', () => {
  let token

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-access-secret'
    token = jwt.sign({ id: 'reader-1' }, process.env.JWT_ACCESS_SECRET)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    Post.findOne.mockReturnValue({
      select: () => ({ lean: () => Promise.resolve({ activity: { total_likes: 5, total_comments: 3 } }) }),
    })
  })

  it('returns the numbers to a signed-in reader', async () => {
    const res = await post({ blog_id: 'my-post' }, { token })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ activity: { total_likes: 5, total_comments: 3 } })
  })

  it('rejects a request with no token, before reading the database', async () => {
    const res = await post({ blog_id: 'my-post' })

    expect(res.status).toBe(401)
    expect(Post.findOne).not.toHaveBeenCalled()
  })

  it('rejects an object-valued blog_id, before reading the database', async () => {
    const res = await post({ blog_id: { $ne: null } }, { token })

    expect(res.status).toBe(400)
    expect(Post.findOne).not.toHaveBeenCalled()
  })

  it('throttles a flood per IP, even without a valid token', async () => {
    const ip = '10.1.0.2'
    for (let i = 0; i < 100; i++) await post({ blog_id: 'my-post' }, { ip })

    const res = await post({ blog_id: 'my-post' }, { ip, token })

    expect(res.status).toBe(429)
  })
})
