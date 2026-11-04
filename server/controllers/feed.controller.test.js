import { describe, it, expect, vi } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import request from 'supertest'
import express from 'express'

vi.mock('../Schema/Post.js', () => ({ default: { find: vi.fn() } }))
vi.mock('../Schema/User.js', () => ({ default: { findOne: vi.fn() } }))
vi.mock('../Schema/Publication.js', () => ({ default: { findOne: vi.fn() } }))

import Post from '../Schema/Post.js'
import User from '../Schema/User.js'
import Publication from '../Schema/Publication.js'
import feedRoutes from '../routes/feed.routes.js'
import {
  buildFeed,
  buildUserFeed,
  buildPublicationFeed,
} from './feed.controller.js'

const findChain = (result) => {
  const q = {}
  q.select = vi.fn(() => q)
  q.sort = vi.fn(() => q)
  q.limit = vi.fn(() => q)
  q.lean = vi.fn(() => Promise.resolve(result))
  return q
}

const findOneChain = (result) => {
  const q = {}
  q.select = vi.fn(() => q)
  q.lean = vi.fn(() => Promise.resolve(result))
  return q
}

const makeApp = () => {
  const app = express()
  app.use('/api/v1', feedRoutes)
  return app
}

describe('buildFeed (pure)', () => {
  it('produces a valid RSS 2.0 channel with items', () => {
    const xml = buildFeed({
      title: 'My Feed',
      description: 'Desc',
      link: 'https://kalamio.com/user/ada',
      selfUrl: 'https://kalamio.com/api/v1/feed/user/ada.xml',
      posts: [{ blog_id: 'p1', title: 'Post', des: 'Body', publishedAt: '2026-01-01T00:00:00.000Z' }],
    })
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">')
    expect(xml).toContain('<title>My Feed</title>')
    expect(xml).toContain('<link>https://kalamio.com/user/ada</link>')
    expect(xml).toContain('<description>Desc</description>')
    expect(xml).toContain('<item>')
    expect(xml).toContain('<title>Post</title>')
    expect(xml).toContain('<link>https://kalamio.com/blog/p1</link>')
    expect(xml).toContain('<guid isPermaLink="true">https://kalamio.com/blog/p1</guid>')
    expect(xml).toContain('<pubDate>')
    expect(xml).toContain('</rss>')
  })

  it('returns an empty but valid channel for no posts', () => {
    const xml = buildFeed({ title: 'Empty', description: 'D', link: 'https://x', selfUrl: 'https://x/feed.xml', posts: [] })
    expect(xml).toContain('<channel>')
    expect((xml.match(/<item>/g) || []).length).toBe(0)
    expect(xml).toContain('</channel>')
  })

  it('escapes title and description', () => {
    const xml = buildFeed({
      title: '<script>x</script>',
      description: 'a & b',
      link: 'https://x',
      selfUrl: 'https://x/feed.xml',
      posts: [{ blog_id: 'p', title: '<b>t</b>', des: '"><img>', publishedAt: '2026-01-01T00:00:00.000Z' }],
    })
    expect(xml).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(xml).toContain('a &amp; b')
    expect(xml).toContain('&lt;b&gt;t&lt;/b&gt;')
    expect(xml).toContain('&quot;&gt;&lt;img&gt;')
  })

  it('omits pubDate for invalid or missing dates', () => {
    const xml = buildFeed({
      title: 'T',
      description: 'D',
      link: 'https://x',
      selfUrl: 'https://x/feed.xml',
      posts: [{ blog_id: 'p', title: 'T', des: 'D', publishedAt: 'not-a-date' }],
    })
    expect(xml).not.toContain('<pubDate>')
    expect(xml).toContain('<lastBuildDate>')
  })
})

describe('buildUserFeed (pure)', () => {
  it('builds a user feed', () => {
    const xml = buildUserFeed({
      user: { personal_info: { username: 'ada', fullname: 'Ada', bio: 'Writer' } },
      posts: [{ blog_id: 'p1', title: 'Post', des: 'Body', publishedAt: '2026-01-01T00:00:00.000Z' }],
    })
    expect(xml).toContain('<title>Ada on Kalamio</title>')
    expect(xml).toContain('<link>https://kalamio.com/user/ada</link>')
    expect(xml).toContain('https://kalamio.com/api/v1/feed/user/ada.xml')
  })
})

describe('buildPublicationFeed (pure)', () => {
  it('builds a publication feed', () => {
    const xml = buildPublicationFeed({
      publication: { slug: 'my-pub', title: 'My Pub', description: 'A pub' },
      posts: [{ blog_id: 'p1', title: 'Post', des: 'Body', publishedAt: '2026-01-01T00:00:00.000Z' }],
    })
    expect(xml).toContain('<title>My Pub — Kalamio</title>')
    expect(xml).toContain('<link>https://kalamio.com/publication/my-pub</link>')
    expect(xml).toContain('https://kalamio.com/api/v1/feed/publication/my-pub.xml')
  })
})

describe('user feed endpoint — GET /api/v1/feed/user/:username.xml', () => {
  it('serves a feed for a public active profile', async () => {
    User.findOne.mockReturnValue(
      findOneChain({
        _id: 'userId1',
        personal_info: { username: 'ada', fullname: 'Ada', bio: 'Writer' },
        account_status: { status: 'active' },
        privacy_settings: { show_profile: 'everyone' },
      }),
    )
    Post.find.mockReturnValue(
      findChain([{ blog_id: 'p1', title: 'Post', des: 'Body', publishedAt: '2026-01-01T00:00:00.000Z' }]),
    )

    const res = await request(makeApp()).get('/api/v1/feed/user/ada.xml')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/rss\+xml|xml/)
    expect(res.headers['cache-control']).toContain('max-age=3600')
    expect(res.text).toContain('<item>')
    expect(res.text).toContain('https://kalamio.com/blog/p1')
    expect(Post.find).toHaveBeenCalledWith({ author: 'userId1', draft: false, type: 'blog' })
    expect(Post.find().sort).toHaveBeenCalledWith({ publishedAt: -1 })
    expect(Post.find().limit).toHaveBeenCalledWith(20)
  })

  it('returns 404 for an unknown user', async () => {
    User.findOne.mockReturnValue(findOneChain(null))
    const res = await request(makeApp()).get('/api/v1/feed/user/missing.xml')
    expect(res.status).toBe(404)
  })

  it('returns 404 for a deactivated user', async () => {
    User.findOne.mockReturnValue(
      findOneChain({
        _id: 'userId1',
        personal_info: { username: 'ada' },
        account_status: { status: 'deactivated' },
        privacy_settings: { show_profile: 'everyone' },
      }),
    )
    const res = await request(makeApp()).get('/api/v1/feed/user/ada.xml')
    expect(res.status).toBe(404)
  })

  it('returns 404 for a deleted user', async () => {
    User.findOne.mockReturnValue(
      findOneChain({
        _id: 'userId1',
        personal_info: { username: 'ada' },
        account_status: { status: 'deleted' },
        privacy_settings: { show_profile: 'everyone' },
      }),
    )
    const res = await request(makeApp()).get('/api/v1/feed/user/ada.xml')
    expect(res.status).toBe(404)
  })

  it('returns 404 for a logged-in-only profile', async () => {
    User.findOne.mockReturnValue(
      findOneChain({
        _id: 'userId1',
        personal_info: { username: 'ada' },
        account_status: { status: 'active' },
        privacy_settings: { show_profile: 'logged_in' },
      }),
    )
    const res = await request(makeApp()).get('/api/v1/feed/user/ada.xml')
    expect(res.status).toBe(404)
  })

  it('serves an empty but valid feed', async () => {
    User.findOne.mockReturnValue(
      findOneChain({
        _id: 'userId1',
        personal_info: { username: 'ada', fullname: 'Ada' },
        account_status: { status: 'active' },
        privacy_settings: { show_profile: 'everyone' },
      }),
    )
    Post.find.mockReturnValue(findChain([]))
    const res = await request(makeApp()).get('/api/v1/feed/user/ada.xml')
    expect(res.status).toBe(200)
    expect((res.text.match(/<item>/g) || []).length).toBe(0)
    expect(res.text).toContain('</rss>')
  })

  it('escapes malicious content', async () => {
    User.findOne.mockReturnValue(
      findOneChain({
        _id: 'userId1',
        personal_info: { username: 'ada', fullname: '</title><script>x</script>' },
        account_status: { status: 'active' },
        privacy_settings: { show_profile: 'everyone' },
      }),
    )
    Post.find.mockReturnValue(
      findChain([{ blog_id: 'p', title: '<script>alert(1)</script>', des: '"><img>', publishedAt: '2026-01-01T00:00:00.000Z' }]),
    )
    const res = await request(makeApp()).get('/api/v1/feed/user/ada.xml')
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('<script>alert(1)</script>')
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('publication feed endpoint — GET /api/v1/feed/publication/:slug.xml', () => {
  it('serves a feed for a public publication', async () => {
    Publication.findOne.mockReturnValue(findOneChain({ _id: 'pubId1', slug: 'my-pub', title: 'My Pub', description: 'A pub', visibility: 'public' }))
    Post.find.mockReturnValue(
      findChain([{ blog_id: 'p1', title: 'Post', des: 'Body', publishedAt: '2026-01-01T00:00:00.000Z' }]),
    )

    const res = await request(makeApp()).get('/api/v1/feed/publication/my-pub.xml')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/rss\+xml|xml/)
    expect(res.headers['cache-control']).toContain('max-age=3600')
    expect(res.text).toContain('<item>')
    expect(res.text).toContain('https://kalamio.com/blog/p1')
    expect(Post.find).toHaveBeenCalledWith({ publication: 'pubId1', draft: false, type: 'blog' })
    expect(Post.find().sort).toHaveBeenCalledWith({ publishedAt: -1 })
    expect(Post.find().limit).toHaveBeenCalledWith(20)
  })

  it('returns 404 for an unknown publication', async () => {
    Publication.findOne.mockReturnValue(findOneChain(null))
    const res = await request(makeApp()).get('/api/v1/feed/publication/missing.xml')
    expect(res.status).toBe(404)
  })

  it('returns 404 for a private publication', async () => {
    Publication.findOne.mockReturnValue(findOneChain({ _id: 'pubId1', slug: 'my-pub', title: 'My Pub', visibility: 'private' }))
    const res = await request(makeApp()).get('/api/v1/feed/publication/my-pub.xml')
    expect(res.status).toBe(404)
  })

  it('serves an empty but valid feed', async () => {
    Publication.findOne.mockReturnValue(findOneChain({ _id: 'pubId1', slug: 'my-pub', title: 'My Pub', visibility: 'public' }))
    Post.find.mockReturnValue(findChain([]))
    const res = await request(makeApp()).get('/api/v1/feed/publication/my-pub.xml')
    expect(res.status).toBe(200)
    expect((res.text.match(/<item>/g) || []).length).toBe(0)
    expect(res.text).toContain('</rss>')
  })
})

const parseXml = (xml) => new DOMParser().parseFromString(xml, 'application/xml');

const assertWellFormedXml = (xml) => {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const document = parseXml(xml);
  expect(document.documentElement.nodeName).toBe('rss');
  expect(document.getElementsByTagName('channel').length).toBe(1);
  expect(document.getElementsByTagName('parsererror').length).toBe(0);
  return document;
};

describe('XML well-formedness', () => {
  it('parses a populated user feed', async () => {
    User.findOne.mockReturnValue(
      findOneChain({
        _id: 'userId1',
        personal_info: { username: 'ada', fullname: 'Ada' },
        account_status: { status: 'active' },
        privacy_settings: { show_profile: 'everyone' },
      }),
    )
    Post.find.mockReturnValue(
      findChain([{ blog_id: 'p1', title: 'Post', des: 'Body', publishedAt: '2026-01-01T00:00:00.000Z' }]),
    )
    const res = await request(makeApp()).get('/api/v1/feed/user/ada.xml')
    expect(res.status).toBe(200)
    assertWellFormedXml(res.text)
  })

  it('parses a populated publication feed', async () => {
    Publication.findOne.mockReturnValue(findOneChain({ _id: 'pubId1', slug: 'my-pub', title: 'My Pub', visibility: 'public' }))
    Post.find.mockReturnValue(
      findChain([{ blog_id: 'p1', title: 'Post', des: 'Body', publishedAt: '2026-01-01T00:00:00.000Z' }]),
    )
    const res = await request(makeApp()).get('/api/v1/feed/publication/my-pub.xml')
    expect(res.status).toBe(200)
    assertWellFormedXml(res.text)
  })

  it('parses an empty feed', async () => {
    Publication.findOne.mockReturnValue(findOneChain({ _id: 'pubId1', slug: 'my-pub', title: 'My Pub', visibility: 'public' }))
    Post.find.mockReturnValue(findChain([]))
    const res = await request(makeApp()).get('/api/v1/feed/publication/my-pub.xml')
    expect(res.status).toBe(200)
    assertWellFormedXml(res.text)
  })

  it('parses a feed with an invalid item date', async () => {
    Publication.findOne.mockReturnValue(findOneChain({ _id: 'pubId1', slug: 'my-pub', title: 'My Pub', visibility: 'public' }))
    Post.find.mockReturnValue(findChain([{ blog_id: 'p1', title: 'Post', des: 'Body', publishedAt: 'not-a-date' }]))
    const res = await request(makeApp()).get('/api/v1/feed/publication/my-pub.xml')
    expect(res.status).toBe(200)
    assertWellFormedXml(res.text)
    expect(res.text).not.toContain('<pubDate>')
  })
})

describe('XML malformed input rejection', () => {
  it('rejects malformed XML', () => {
    const parser = new DOMParser();
    expect(() => parser.parseFromString('<rss><channel><title>x</title></channel>', 'application/xml')).toThrow();
  })

  it('rejects mismatched XML tags', () => {
    const parser = new DOMParser();
    expect(() => parser.parseFromString('<rss><channel><title>x</title></rss></channel>', 'application/xml')).toThrow();
  })
})
