import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import api from './api'
import { proxyImageUrl } from './imageProxy'

const S3_ORIGIN = 'https://blog-app-82817.s3.ap-south-1.amazonaws.com'
const CDN_HOST = 'https://cdn.kalamio.com'

describe('proxyImageUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('owned image URLs', () => {
    it('routes S3 origin images through the API image-proxy endpoint', () => {
      const s3Url = `${S3_ORIGIN}/uploads/user-avatar.jpg`
      const expected = `${api.defaults.baseURL}/image-proxy?url=${encodeURIComponent(s3Url)}`
      expect(proxyImageUrl(s3Url)).toBe(expected)
    })

    it('correctly encodes special characters, spaces, and query parameters in the URL', () => {
      const s3UrlWithSpecialChars = `${S3_ORIGIN}/uploads/user avatar & photo.jpg?size=large&v=1.2`
      const expected = `${api.defaults.baseURL}/image-proxy?url=${encodeURIComponent(s3UrlWithSpecialChars)}`
      expect(proxyImageUrl(s3UrlWithSpecialChars)).toBe(expected)
    })

    it('routes CDN images through the proxy when VITE_CDN_DOMAIN is configured', async () => {
      vi.stubEnv('VITE_CDN_DOMAIN', CDN_HOST)
      vi.resetModules()
      const { proxyImageUrl: dynamicProxyImageUrl } = await import('./imageProxy')

      const cdnUrl = `${CDN_HOST}/uploads/profile.webp`
      const expected = `${api.defaults.baseURL}/image-proxy?url=${encodeURIComponent(cdnUrl)}`
      expect(dynamicProxyImageUrl(cdnUrl)).toBe(expected)
    })
  })

  describe('foreign / external image URLs', () => {
    it('leaves Google OAuth profile avatars untouched (direct load)', () => {
      const googleAvatar = 'https://lh3.googleusercontent.com/a/ACg8ocI123=s96-c'
      expect(proxyImageUrl(googleAvatar)).toBe(googleAvatar)
    })

    it('leaves Dicebear avatars untouched', () => {
      const dicebearAvatar = 'https://api.dicebear.com/7.x/identicon/svg?seed=kalamio'
      expect(proxyImageUrl(dicebearAvatar)).toBe(dicebearAvatar)
    })

    it('leaves third-party image URLs untouched', () => {
      const unsplashUrl = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb'
      expect(proxyImageUrl(unsplashUrl)).toBe(unsplashUrl)
    })

    it('leaves images from other S3 buckets/regions untouched', () => {
      const otherBucket = 'https://other-bucket.s3.ap-south-1.amazonaws.com/pic.jpg'
      expect(proxyImageUrl(otherBucket)).toBe(otherBucket)
    })

    it('leaves already-proxied URLs untouched (does not double-proxy)', () => {
      const alreadyProxied = `${api.defaults.baseURL}/image-proxy?url=${encodeURIComponent(`${S3_ORIGIN}/test.jpg`)}`
      expect(proxyImageUrl(alreadyProxied)).toBe(alreadyProxied)
    })
  })

  describe('non-remote schemes and local URLs', () => {
    it('leaves blob: URLs untouched (fresh local uploads are already same-origin)', () => {
      const blobUrl = 'blob:http://localhost:5173/d5f49221-5a41-4cbe-8232-a5cfb5f3a04a'
      expect(proxyImageUrl(blobUrl)).toBe(blobUrl)
    })

    it('leaves data: URIs untouched', () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      expect(proxyImageUrl(dataUri)).toBe(dataUri)
    })

    it('leaves non-HTTP protocols untouched', () => {
      expect(proxyImageUrl('ftp://files.example.com/avatar.jpg')).toBe('ftp://files.example.com/avatar.jpg')
    })

    it('leaves relative paths untouched', () => {
      expect(proxyImageUrl('/images/placeholder.png')).toBe('/images/placeholder.png')
      expect(proxyImageUrl('./avatar.png')).toBe('./avatar.png')
    })
  })

  describe('unusual, empty, and invalid inputs', () => {
    it('returns empty string when given an empty URL', () => {
      expect(proxyImageUrl('')).toBe('')
    })

    it('returns whitespace string untouched', () => {
      expect(proxyImageUrl('   ')).toBe('   ')
    })

    it('returns non-string inputs untouched without throwing', () => {
      expect(proxyImageUrl(null)).toBe(null)
      expect(proxyImageUrl(undefined)).toBe(undefined)
      expect(proxyImageUrl(12345)).toBe(12345)
      expect(proxyImageUrl({})).toEqual({})
      expect(proxyImageUrl([])).toEqual([])
    })
  })
})
