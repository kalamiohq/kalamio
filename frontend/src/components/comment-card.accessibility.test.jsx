import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../App', async () => {
  const { createContext } = await import('react')
  return { UserContext: createContext({}) }
})

vi.mock('../pages/blog.page', async () => {
  const { createContext } = await import('react')
  return { BlogContext: createContext({}) }
})

vi.mock('../common/api', () => ({ default: { post: vi.fn() } }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

import api from '../common/api'
import { UserContext } from '../App'
import { BlogContext } from '../pages/blog.page'
import CommentCard from './comment-card.component'

afterEach(cleanup)

describe('CommentCard accessible names', () => {
  beforeEach(() => {
    api.post.mockResolvedValue({
      data: {
        replies: [
          {
            _id: 'reply-1',
            commentedAt: '2026-10-28T12:00:00.000Z',
            comment: 'A reply',
            commented_by: { personal_info: { fullname: 'Reply Author', username: 'reply-author' } },
          },
        ],
        reply_count: 1,
      },
    })
  })

  it('mounts and unmounts when the comment author changes', () => {
    const comment = {
      _id: 'comment-1',
      commented_by: {
        _id: 'author-1',
        personal_info: {
          fullname: 'Comment Author',
          username: 'comment-author',
        },
      },
      commentedAt: '2026-10-28T12:00:00.000Z',
      comment: 'A comment',
      children: [],
    }
    const blog = {
      comments: { results: [comment] },
      activity: { total_parent_comments: 1 },
      author: { personal_info: { username: 'blog-owner' } },
    }
    const card = (commentData) => (
      <MemoryRouter>
        <UserContext.Provider
          value={{ userAuth: { access_token: '', username: 'reader' } }}
        >
          <BlogContext.Provider value={{ blog, setBlog: vi.fn(), setTotalParentCommentsLoaded: vi.fn() }}>
            <CommentCard index={0} commentData={commentData} isTextPost />
          </BlogContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>
    )
    const { rerender } = render(card(comment))

    expect(screen.getByText('Comment Author')).toBeInTheDocument()
    expect(screen.getByText('A comment')).toBeInTheDocument()

    const commentWithoutAuthor = { ...comment, commented_by: undefined }
    rerender(card(commentWithoutAuthor))

    expect(screen.queryByText('Comment Author')).not.toBeInTheDocument()
    expect(screen.queryByText('A comment')).not.toBeInTheDocument()

    rerender(card(comment))

    expect(screen.getByText('Comment Author')).toBeInTheDocument()
    expect(screen.getByText('A comment')).toBeInTheDocument()
  })

  it('names the comment menu and share actions', async () => {
    const comment = {
      _id: 'comment-1',
      commented_by: {
        _id: 'author-1',
        personal_info: { fullname: 'Comment Author', username: 'comment-author' },
      },
      commentedAt: '2026-10-28T12:00:00.000Z',
      comment: 'A comment',
      children: ['reply-1'],
    }
    const blog = {
      comments: { results: [comment] },
      activity: { total_parent_comments: 1 },
      author: { personal_info: { username: 'blog-owner' } },
    }

    render(
      <MemoryRouter>
        <UserContext.Provider
          value={{ userAuth: { access_token: '', username: 'reader' } }}
        >
          <BlogContext.Provider value={{ blog, setBlog: vi.fn(), setTotalParentCommentsLoaded: vi.fn() }}>
            <CommentCard index={0} commentData={comment} isTextPost />
          </BlogContext.Provider>
        </UserContext.Provider>
      </MemoryRouter>,
    )

    const actionButtons = [
      screen.getByRole('button', { name: 'More comment actions' }),
      screen.getByRole('button', { name: 'Share comment' }),
      await screen.findByRole('button', { name: 'Reshare reply' }),
      screen.getByRole('button', { name: 'Share reply' }),
    ]

    for (const button of actionButtons) {
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
