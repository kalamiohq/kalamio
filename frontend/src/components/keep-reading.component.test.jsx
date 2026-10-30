import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import KeepReading, { saveReadingProgress } from './keep-reading.component'

const STORAGE_KEY = 'kalamio_keep_reading'
const LEGACY_STORAGE_KEY = 'notelys_keep_reading'

const savedArticle = (blogId, title) => ({
  blog_id: blogId,
  title,
  text_content: '',
  type: 'blog',
  banner: '',
  author: 'Writer',
  savedAt: Date.now(),
})

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('KeepReading storage migration', () => {
  it('migrates and displays progress saved under the legacy key', () => {
    const saved = JSON.stringify(savedArticle('legacy-post', 'Saved before update'))
    localStorage.setItem(LEGACY_STORAGE_KEY, saved)

    render(
      <MemoryRouter>
        <KeepReading />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Saved before update/ })).toHaveAttribute(
      'href',
      '/blog/legacy-post',
    )
    expect(localStorage.getItem(STORAGE_KEY)).toBe(saved)
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
  })

  it('preserves existing new-key progress instead of replacing it with legacy data', () => {
    const current = JSON.stringify(savedArticle('current-post', 'Current progress'))
    const legacy = JSON.stringify(savedArticle('legacy-post', 'Older progress'))
    localStorage.setItem(STORAGE_KEY, current)
    localStorage.setItem(LEGACY_STORAGE_KEY, legacy)

    render(
      <MemoryRouter>
        <KeepReading />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Current progress/ })).toHaveAttribute(
      'href',
      '/blog/current-post',
    )
    expect(screen.queryByText('Older progress')).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(current)
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(legacy)
  })

  it.each(['writing the new key', 'removing the legacy key'])(
    'still displays legacy progress if storage fails while %s',
    (operation) => {
      const saved = JSON.stringify(savedArticle('legacy-post', 'Saved before update'))
      localStorage.setItem(LEGACY_STORAGE_KEY, saved)

      if (operation === 'writing the new key') {
        const originalSetItem = Storage.prototype.setItem
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
          if (key === STORAGE_KEY) throw new Error('storage write failed')
          return originalSetItem.call(this, key, value)
        })
      } else {
        const originalRemoveItem = Storage.prototype.removeItem
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
          if (key === LEGACY_STORAGE_KEY) throw new Error('storage removal failed')
          return originalRemoveItem.call(this, key)
        })
      }

      render(
        <MemoryRouter>
          <KeepReading />
        </MemoryRouter>,
      )

      expect(screen.getByRole('link', { name: /Saved before update/ })).toHaveAttribute(
        'href',
        '/blog/legacy-post',
      )
      expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBe(saved)
      if (operation === 'removing the legacy key') {
        expect(localStorage.getItem(STORAGE_KEY)).toBe(saved)
      }
    },
  )

  it('saves new progress under the renamed key', () => {
    saveReadingProgress({
      blog_id: 'new-post',
      title: 'New progress',
      author: { personal_info: { fullname: 'Writer' } },
    })

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({
      blog_id: 'new-post',
      title: 'New progress',
      author: 'Writer',
    })
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
  })
})
