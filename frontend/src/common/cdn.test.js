import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const S3_ORIGIN = 'https://blog-app-82817.s3.ap-south-1.amazonaws.com'
const CDN_HOST = 'https://cdn.kalamio.com'

describe('cdn helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('when VITE_CDN_DOMAIN is configured', () => {
    let cdnUrl, isOwnedImageUrl

    beforeEach(async () => {
      vi.stubEnv('VITE_CDN_DOMAIN', CDN_HOST)
      vi.resetModules()
      const mod = await import('./cdn')
      cdnUrl = mod.cdnUrl
      isOwnedImageUrl = mod.isOwnedImageUrl
    })

    describe('cdnUrl', () => {
      it('rewrites S3 origin URLs to use the CDN domain', () => {
        const s3Url = `${S3_ORIGIN}/uploads/banner.png`
        expect(cdnUrl(s3Url)).toBe(`${CDN_HOST}/uploads/banner.png`)
      })

      it('preserves nested paths, file names, and query parameters', () => {
        const s3Url = `${S3_ORIGIN}/users/123/avatar.webp?v=42&size=thumb`
        expect(cdnUrl(s3Url)).toBe(`${CDN_HOST}/users/123/avatar.webp?v=42&size=thumb`)
      })

      it('leaves already-CDN URLs untouched (does not double-rewrite)', () => {
        const existingCdnUrl = `${CDN_HOST}/uploads/banner.png`
        expect(cdnUrl(existingCdnUrl)).toBe(existingCdnUrl)
      })

      it('leaves foreign hosts untouched', () => {
        const googleUrl = 'https://lh3.googleusercontent.com/a/ACg8ocI=s96-c'
        const dicebearUrl = 'https://api.dicebear.com/7.x/identicon/svg?seed=user'
        const unsplashUrl = 'https://images.unsplash.com/photo-123'
        expect(cdnUrl(googleUrl)).toBe(googleUrl)
        expect(cdnUrl(dicebearUrl)).toBe(dicebearUrl)
        expect(cdnUrl(unsplashUrl)).toBe(unsplashUrl)
      })

      it('leaves different S3 bucket/region URLs untouched', () => {
        const otherBucket = 'https://other-bucket.s3.ap-south-1.amazonaws.com/pic.jpg'
        const otherRegion = 'https://blog-app-82817.s3.us-east-1.amazonaws.com/pic.jpg'
        expect(cdnUrl(otherBucket)).toBe(otherBucket)
        expect(cdnUrl(otherRegion)).toBe(otherRegion)
      })

      it('leaves data: and blob: URLs untouched', () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        const blobUrl = 'blob:http://localhost:5173/00000000-0000-0000-0000-000000000000'
        expect(cdnUrl(dataUrl)).toBe(dataUrl)
        expect(cdnUrl(blobUrl)).toBe(blobUrl)
      })

      it('handles empty strings and whitespace', () => {
        expect(cdnUrl('')).toBe('')
        expect(cdnUrl('   ')).toBe('   ')
      })

      it('handles non-string inputs safely', () => {
        expect(cdnUrl(null)).toBe(null)
        expect(cdnUrl(undefined)).toBe(undefined)
        expect(cdnUrl(12345)).toBe(12345)
        expect(cdnUrl({})).toEqual({})
        expect(cdnUrl([])).toEqual([])
      })
    })

    describe('isOwnedImageUrl', () => {
      it('returns true for raw S3 origin URLs', () => {
        expect(isOwnedImageUrl(`${S3_ORIGIN}/uploads/image.png`)).toBe(true)
        expect(isOwnedImageUrl(S3_ORIGIN)).toBe(true)
      })

      it('returns true for CDN URLs when CDN domain is configured', () => {
        expect(isOwnedImageUrl(`${CDN_HOST}/uploads/image.png`)).toBe(true)
        expect(isOwnedImageUrl(CDN_HOST)).toBe(true)
      })

      it('returns false for foreign hosts', () => {
        expect(isOwnedImageUrl('https://lh3.googleusercontent.com/avatar.jpg')).toBe(false)
        expect(isOwnedImageUrl('https://api.dicebear.com/avatar.svg')).toBe(false)
        expect(isOwnedImageUrl('https://example.com/image.png')).toBe(false)
      })

      it('returns false for non-remote schemes like data: and blob:', () => {
        expect(isOwnedImageUrl('data:image/png;base64,abc')).toBe(false)
        expect(isOwnedImageUrl('blob:http://localhost:5173/abc')).toBe(false)
      })

      it('returns false for empty and non-string inputs', () => {
        expect(isOwnedImageUrl('')).toBe(false)
        expect(isOwnedImageUrl(null)).toBe(false)
        expect(isOwnedImageUrl(undefined)).toBe(false)
        expect(isOwnedImageUrl(123)).toBe(false)
        expect(isOwnedImageUrl({})).toBe(false)
      })
    })
  })

  describe('when VITE_CDN_DOMAIN has a trailing slash', () => {
    let cdnUrl, isOwnedImageUrl

    beforeEach(async () => {
      vi.stubEnv('VITE_CDN_DOMAIN', 'https://cdn.kalamio.com/')
      vi.resetModules()
      const mod = await import('./cdn')
      cdnUrl = mod.cdnUrl
      isOwnedImageUrl = mod.isOwnedImageUrl
    })

    it('strips the trailing slash when rewriting S3 URLs', () => {
      expect(cdnUrl(`${S3_ORIGIN}/uploads/banner.png`)).toBe('https://cdn.kalamio.com/uploads/banner.png')
    })

    it('correctly matches owned CDN URLs despite trailing slash in configuration', () => {
      expect(isOwnedImageUrl('https://cdn.kalamio.com/uploads/banner.png')).toBe(true)
    })
  })

  describe('when VITE_CDN_DOMAIN is unset / empty', () => {
    let cdnUrl, isOwnedImageUrl

    beforeEach(async () => {
      vi.stubEnv('VITE_CDN_DOMAIN', '')
      vi.resetModules()
      const mod = await import('./cdn')
      cdnUrl = mod.cdnUrl
      isOwnedImageUrl = mod.isOwnedImageUrl
    })

    it('cdnUrl acts as a no-op, keeping S3 origin URLs untouched', () => {
      const s3Url = `${S3_ORIGIN}/uploads/banner.png`
      expect(cdnUrl(s3Url)).toBe(s3Url)
    })

    it('isOwnedImageUrl returns true for S3 origin but false for CDN domain', () => {
      expect(isOwnedImageUrl(`${S3_ORIGIN}/uploads/banner.png`)).toBe(true)
      expect(isOwnedImageUrl('https://cdn.kalamio.com/uploads/banner.png')).toBe(false)
    })
  })
})
