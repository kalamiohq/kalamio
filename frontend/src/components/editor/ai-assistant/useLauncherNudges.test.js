import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLauncherNudges, NUDGES, NUDGE_FIRST_MS, NUDGE_EVERY_MS, NUDGE_VISIBLE_MS } from './useLauncherNudges'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const advance = (ms) => act(() => { vi.advanceTimersByTime(ms) })

describe('useLauncherNudges', () => {
  it('pops up a random nudge after a while, hides it, and repeats with a different one', () => {
    const { result } = renderHook(() => useLauncherNudges(false))
    expect(result.current.nudge).toBeNull()
    advance(NUDGE_FIRST_MS)
    const first = result.current.nudge
    expect(NUDGES).toContain(first)
    advance(NUDGE_VISIBLE_MS)
    expect(result.current.nudge).toBeNull()
    advance(NUDGE_EVERY_MS - NUDGE_VISIBLE_MS)
    expect(NUDGES).toContain(result.current.nudge)
  })

  it('stops for the session once the assistant is opened', () => {
    const { result, rerender } = renderHook(({ open }) => useLauncherNudges(open), { initialProps: { open: false } })
    rerender({ open: true })
    rerender({ open: false })
    advance(NUDGE_FIRST_MS + NUDGE_EVERY_MS * 2)
    expect(result.current.nudge).toBeNull()
  })

  it('stops when dismissed', () => {
    const { result } = renderHook(() => useLauncherNudges(false))
    advance(NUDGE_FIRST_MS)
    act(() => result.current.dismiss())
    expect(result.current.nudge).toBeNull()
    advance(NUDGE_EVERY_MS * 3)
    expect(result.current.nudge).toBeNull()
  })
})
