import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import express from 'express'

// Mock the Mongoose models so tests never touch a database.
vi.mock('../Schema/Post.js', () => ({ default: { findOne: vi.fn() } }))
vi.mock('../Schema/User.js', () => ({ default: { findOne: vi.fn() } }))
vi.mock('../Schema/Publication.js', () => ({ default: { findOne: vi.fn() } }))

import Post from '../Schema/Post.js'
import User from '../Schema/User.js'
import Publication from '../Schema/Publication.js'
import prerenderRoutes from '../routes/prerender.routes.js'
import {
  escapeHtml,
  truncate,
  renderMetaHtml,
  blogMeta,
  userMeta,
  publicationMeta,
} from './prerender.controller.js'

// A chainable Mongoose query mock: .populate().select().lean() → result.
const query = (result) => {
  const q = {}
  q.populate = vi.fn(() => q)
  q.select = vi.fn(() => q)
  q.lean = vi.fn(() => Promise.resolve(result))
  return q
}

const makeApp = () => {
  const app = express()
  app.use('/api/v1', prerenderRoutes)
  return app
}

describe('prerender — pure render helpers', () => {
  it('escapeHtml neutralises every HTML-significant character', () => {
    expect(escapeHtml(`<b>"a"&'x'</b>`)).toBe(
      '&lt;b&gt;&quot;a&quot;&amp;&#39;x&#39;&lt;/b&gt;',
    )
  })

  it('truncate collapses whitespace and appends an ellipsis past the limit', () => {
    expect(truncate('a  b   c')).toBe('a b c')
    const t = truncate('x'.repeat(50), 10)
    expect(t.length).toBeLessThanOrEqual(10)
    expect(t.endsWith('…')).toBe(true)
  })

  it('blogMeta produces article meta with a BlogPosting JSON-LD', () => {
    const m = blogMeta({
      blog_id: 'p1',
      title: 'Hi',
      des: 'Desc',
      banner: 'https://s3/b.jpg',
      publishedAt: '2026-01-01',
      author: { personal_info: { fullname: 'Ada', username: 'ada' } },
    })
    expect(m.type).toBe('article')
    expect(m.image).toBe('https://s3/b.jpg')
    expect(m.url).toContain('/blog/p1')
    expect(m.jsonLd['@type']).toBe('BlogPosting')
    expect(m.jsonLd.author.url).toContain('/user/ada')
  })

  it('renderMetaHtml escapes a malicious title in every sink', () => {
    const html = renderMetaHtml(
      blogMeta({
        blog_id: 'x',
        title: '</title><script>alert(1)</script>',
        author: { personal_info: {} },
      }),
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('userMeta is a profile, publicationMeta is a website', () => {
    expect(userMeta({ personal_info: { username: 'bob', fullname: 'Bob' } }).type).toBe('profile')
    expect(publicationMeta({ title: 'Pub', slug: 'pub' }).type).toBe('website')
  })
})

describe('prerender endpoint — GET /api/v1/prerender/*', () => {
  it('renders a blog’s OG tags + JSON-LD when the post is found', async () => {
    Post.findOne.mockReturnValue(
      query({
        blog_id: 'my-post',
        title: 'Great Post',
        des: 'A wonderful read.',
        banner: 'https://s3/banner.jpg',
        type: 'blog',
        publishedAt: '2026-01-01',
        author: { personal_info: { fullname: 'Ada', username: 'ada' } },
      }),
    )

    const res = await request(makeApp()).get('/api/v1/prerender/blog/my-post')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.headers['x-prerender']).toBe('kalamio')
    expect(res.headers['cache-control']).toContain('max-age')
    expect(res.text).toContain('property="og:title" content="Great Post"')
    expect(res.text).toContain('property="og:image" content="https://s3/banner.jpg"')
    expect(res.text).toContain('property="og:type" content="article"')
    expect(res.text).toContain('property="og:url" content="https://kalamio.com/blog/my-post"')
    expect(res.text).toContain('"@type":"BlogPosting"')
    // Only published posts are prerendered.
    expect(Post.findOne).toHaveBeenCalledWith({ blog_id: 'my-post', draft: false })
  })

  it('falls back to site defaults when the blog is not found', async () => {
    Post.findOne.mockReturnValue(query(null))
    const res = await request(makeApp()).get('/api/v1/prerender/blog/missing')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>Kalamio</title>')
    expect(res.text).toContain('property="og:url" content="https://kalamio.com/blog/missing"')
  })

  it('renders profile meta for a user', async () => {
    User.findOne.mockReturnValue(
      query({
        personal_info: {
          fullname: 'Bob Smith',
          username: 'bob',
          bio: 'Writer.',
          profile_img: 'https://s3/bob.png',
        },
      }),
    )
    const res = await request(makeApp()).get('/api/v1/prerender/user/bob')
    expect(res.text).toContain('property="og:type" content="profile"')
    expect(res.text).toContain('property="og:image" content="https://s3/bob.png"')
    expect(res.text).toContain('property="og:title" content="Bob Smith"')
    expect(User.findOne).toHaveBeenCalledWith({ 'personal_info.username': 'bob' })
  })

  it('renders publication meta', async () => {
    Publication.findOne.mockReturnValue(
      query({
        title: 'My Pub',
        slug: 'my-pub',
        description: 'A publication.',
        profile_photo: 'https://s3/pub.png',
      }),
    )
    const res = await request(makeApp()).get('/api/v1/prerender/publication/my-pub')
    expect(res.text).toContain('property="og:url" content="https://kalamio.com/publication/my-pub"')
    expect(res.text).toContain('property="og:image" content="https://s3/pub.png"')
  })

  it('escapes malicious blog content so no tag can be injected (XSS)', async () => {
    Post.findOne.mockReturnValue(
      query({
        blog_id: 'x',
        title: '</title><script>alert(1)</script>',
        des: '"><img src=x onerror=alert(2)>',
        type: 'blog',
        author: { personal_info: {} },
      }),
    )
    const res = await request(makeApp()).get('/api/v1/prerender/blog/x')
    expect(res.status).toBe(200)
    // No raw '<' from user input survives in ANY sink → no tag injection and no
    // </script> breakout from the ld+json block.
    expect(res.text).not.toContain('<script>alert(1)</script>')
    expect(res.text).not.toContain('</title><script>')
    expect(res.text).not.toContain('<img src=x onerror=alert(2)>')
    // HTML sinks are entity-escaped; the ld+json sink escapes '<' as <.
    expect(res.text).toContain('&lt;script&gt;')
    expect(res.text).toContain('\\u003cscript>')
  })

  it('never fails an unfurl — returns 200 defaults even when the DB throws', async () => {
    Post.findOne.mockImplementation(() => {
      throw new Error('db down')
    })
    const res = await request(makeApp()).get('/api/v1/prerender/blog/whatever')
    expect(res.status).toBe(200)
    expect(res.text).toContain('og:site_name')
  })

  it('falls back to defaults for an unknown route type', async () => {
    const res = await request(makeApp()).get('/api/v1/prerender/random/thing')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>Kalamio</title>')
  })
})

describe('prerender RSS discovery metadata', () => {
  it('adds an RSS URL for an older profile that has no stored status or privacy fields', () => {
    const meta = userMeta({ personal_info: { username: 'ada', fullname: 'Ada' } })
    expect(meta.rssUrl).toBe('https://kalamio.com/api/v1/feed/user/ada.xml')
  })

  it('adds an RSS URL for an older publication that has no stored visibility', () => {
    const meta = publicationMeta({ title: 'Pub', slug: 'pub' })
    expect(meta.rssUrl).toBe('https://kalamio.com/api/v1/feed/publication/pub.xml')
  })

  it('adds an RSS URL for an active public profile', () => {
    const meta = userMeta({
      personal_info: { username: 'ada', fullname: 'Ada' },
      account_status: { status: 'active' },
      privacy_settings: { show_profile: 'everyone' },
    })
    expect(meta.rssUrl).toBe('https://kalamio.com/api/v1/feed/user/ada.xml')
  })

  it('does not add an RSS URL for a private profile', () => {
    const meta = userMeta({
      personal_info: { username: 'ada', fullname: 'Ada' },
      account_status: { status: 'active' },
      privacy_settings: { show_profile: 'logged_in' },
    })
    expect(meta.rssUrl).toBeUndefined()
  })

  it('does not add an RSS URL for a deactivated profile', () => {
    const meta = userMeta({
      personal_info: { username: 'ada', fullname: 'Ada' },
      account_status: { status: 'deactivated' },
      privacy_settings: { show_profile: 'everyone' },
    })
    expect(meta.rssUrl).toBeUndefined()
  })

  it('does not add an RSS URL when the username is missing', () => {
    const meta = userMeta({
      personal_info: {},
      account_status: { status: 'active' },
      privacy_settings: { show_profile: 'everyone' },
    })
    expect(meta.rssUrl).toBeUndefined()
  })

  it('adds an RSS URL for a public publication', () => {
    const meta = publicationMeta({ title: 'Pub', slug: 'pub', visibility: 'public' })
    expect(meta.rssUrl).toBe('https://kalamio.com/api/v1/feed/publication/pub.xml')
  })

  it('does not add an RSS URL for a private publication', () => {
    const meta = publicationMeta({ title: 'Pub', slug: 'pub', visibility: 'private' })
    expect(meta.rssUrl).toBeUndefined()
  })

  it('does not add an RSS URL for a publication without a slug', () => {
    const meta = publicationMeta({ title: 'Pub', visibility: 'public' })
    expect(meta.rssUrl).toBeUndefined()
  })

  it('renderMetaHtml emits an escaped RSS alternate link', () => {
    const html = renderMetaHtml({
      title: 'Ada',
      description: 'Bio',
      url: 'https://kalamio.com/user/ada',
      rssUrl: 'https://kalamio.com/api/v1/feed/user/ada?a=1&b=2',
    })
    expect(html).toContain('rel="alternate"')
    expect(html).toContain('type="application/rss+xml"')
    expect(html).toContain('href="https://kalamio.com/api/v1/feed/user/ada?a=1&amp;b=2"')
    expect(html).toContain('title="Ada RSS Feed"')
  })

  it('renderMetaHtml omits the RSS alternate link when rssUrl is absent', () => {
    const html = renderMetaHtml({
      title: 'Ada',
      description: 'Bio',
      url: 'https://kalamio.com/user/ada',
    })
    expect(html).not.toContain('rel="alternate"')
  })
})
