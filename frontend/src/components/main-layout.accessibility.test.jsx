import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import MainLayout from './main-layout.component'

vi.mock('../App', async () => {
  const { createContext } = await import('react')
  return {
    ThemeContext: createContext({}),
    UserContext: createContext({ userAuth: {}, setUserAuth: () => {} }),
  }
})

vi.mock('./left-sidebar.component', () => ({ default: () => null }))
vi.mock('./mobile-top-bar.component', () => ({ default: () => null }))
vi.mock('./bottom-tab-bar.component', () => ({ default: () => null }))
vi.mock('./user-navigation.component', () => ({ default: () => null }))
vi.mock('./Avatar', () => ({ default: () => null }))

function Article() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>Back to feed</button>
}

describe('MainLayout skip link', () => {
  it('moves keyboard focus without adding a history step', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/')
    window.history.pushState(null, '', '/blog/example')
    const entryCount = window.history.length

    render(
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<h1>Feed</h1>} />
            <Route path="blog/:id" element={<Article />} />
          </Route>
        </Routes>
      </BrowserRouter>,
    )

    const link = screen.getByRole('link', { name: 'Skip to content' })
    const back = screen.getByRole('button', { name: 'Back to feed' })
    await user.tab()
    expect(link).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(window.location.hash).toBe('')
    expect(window.history.length).toBe(entryCount)
    expect(screen.getByRole('main')).toHaveFocus()
    await user.tab()
    expect(back).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'Feed' })).toBeInTheDocument()
  })
})
