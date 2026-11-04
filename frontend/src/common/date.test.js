import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDay, getFullDay, getRelativeTime } from './date'

describe('date helpers', () => {
  describe('getDay', () => {
    it('formats a date into "D Mon" format with normal inputs', () => {
      // Using explicit local date instances to avoid timezone shifts
      expect(getDay(new Date(2024, 0, 15))).toBe('15 Jan')
      expect(getDay(new Date(2024, 2, 8))).toBe('8 Mar')
      expect(getDay(new Date(2024, 6, 21))).toBe('21 Jul')
      expect(getDay(new Date(2024, 11, 31))).toBe('31 Dec')
    })

    it('handles numeric timestamps and date strings', () => {
      const date = new Date(2023, 4, 10)
      expect(getDay(date.getTime())).toBe('10 May')
      expect(getDay(date.toString())).toBe('10 May')
    })

    it('handles leap years and month boundaries', () => {
      expect(getDay(new Date(2024, 1, 29))).toBe('29 Feb')
      expect(getDay(new Date(2024, 0, 1))).toBe('1 Jan')
      expect(getDay(new Date(2024, 11, 31))).toBe('31 Dec')
    })

    it('handles future dates correctly', () => {
      expect(getDay(new Date(2099, 10, 20))).toBe('20 Nov')
    })

    it('handles epoch timestamp', () => {
      const epochDate = new Date(0)
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      expect(getDay(0)).toBe(`${epochDate.getDate()} ${months[epochDate.getMonth()]}`)
    })

    it('returns "NaN undefined" for invalid date strings', () => {
      expect(getDay('invalid-date')).toBe('NaN undefined')
    })
  })

  describe('getFullDay', () => {
    it('formats a date into "D Mon YYYY" format with normal inputs', () => {
      expect(getFullDay(new Date(2024, 0, 15))).toBe('15 Jan 2024')
      expect(getFullDay(new Date(2023, 9, 4))).toBe('4 Oct 2023')
      expect(getFullDay(new Date(2022, 11, 25))).toBe('25 Dec 2022')
    })

    it('handles numeric timestamps and date strings', () => {
      const date = new Date(2025, 7, 19)
      expect(getFullDay(date.getTime())).toBe('19 Aug 2025')
      expect(getFullDay(date.toString())).toBe('19 Aug 2025')
    })

    it('handles leap day and historical dates', () => {
      expect(getFullDay(new Date(2020, 1, 29))).toBe('29 Feb 2020')
      expect(getFullDay(new Date(1995, 4, 12))).toBe('12 May 1995')
      expect(getFullDay(new Date(2000, 0, 1))).toBe('1 Jan 2000')
    })

    it('handles future dates', () => {
      expect(getFullDay(new Date(2050, 5, 30))).toBe('30 Jun 2050')
    })

    it('returns "NaN undefined NaN" for invalid date strings', () => {
      expect(getFullDay('invalid-date')).toBe('NaN undefined NaN')
    })
  })

  describe('getRelativeTime', () => {
    const fixedNow = new Date(2024, 5, 15, 12, 0, 0) // 15 Jun 2024 12:00:00

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(fixedNow)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns "just now" for times less than 1 minute ago', () => {
      expect(getRelativeTime(fixedNow)).toBe('just now')
      expect(getRelativeTime(new Date(fixedNow.getTime() - 10 * 1000))).toBe('just now') // 10s ago
      expect(getRelativeTime(new Date(fixedNow.getTime() - 59 * 1000))).toBe('just now') // 59s ago
      expect(getRelativeTime(new Date(fixedNow.getTime() - 59999))).toBe('just now')
    })

    it('returns "just now" for future dates (unusual input where diffMin < 1)', () => {
      expect(getRelativeTime(new Date(fixedNow.getTime() + 10 * 1000))).toBe('just now') // 10s in future
      expect(getRelativeTime(new Date(fixedNow.getTime() + 60 * 60 * 1000))).toBe('just now') // 1hr in future
      expect(getRelativeTime(new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000))).toBe('just now') // 1 day in future
      expect(getRelativeTime(new Date(2099, 0, 1))).toBe('just now')
    })

    it('returns minutes ago for times between 1 and 59 minutes ago', () => {
      expect(getRelativeTime(new Date(fixedNow.getTime() - 60 * 1000))).toBe('1m ago') // exact 1 min
      expect(getRelativeTime(new Date(fixedNow.getTime() - 15 * 60 * 1000))).toBe('15m ago')
      expect(getRelativeTime(new Date(fixedNow.getTime() - 59 * 60 * 1000))).toBe('59m ago')
      expect(getRelativeTime(new Date(fixedNow.getTime() - (59 * 60 * 1000 + 59 * 1000)))).toBe('59m ago')
    })

    it('returns hours ago for times between 1 and 23 hours ago', () => {
      expect(getRelativeTime(new Date(fixedNow.getTime() - 60 * 60 * 1000))).toBe('1h ago') // exact 1 hr
      expect(getRelativeTime(new Date(fixedNow.getTime() - 5 * 60 * 60 * 1000))).toBe('5h ago')
      expect(getRelativeTime(new Date(fixedNow.getTime() - 23 * 60 * 60 * 1000))).toBe('23h ago')
      expect(getRelativeTime(new Date(fixedNow.getTime() - (23 * 60 * 60 * 1000 + 59 * 60 * 1000)))).toBe('23h ago')
    })

    it('returns days ago for times between 1 and 6 days ago', () => {
      expect(getRelativeTime(new Date(fixedNow.getTime() - 24 * 60 * 60 * 1000))).toBe('1d ago') // exact 1 day
      expect(getRelativeTime(new Date(fixedNow.getTime() - 3 * 24 * 60 * 60 * 1000))).toBe('3d ago')
      expect(getRelativeTime(new Date(fixedNow.getTime() - 6 * 24 * 60 * 60 * 1000))).toBe('6d ago')
      expect(getRelativeTime(new Date(fixedNow.getTime() - (6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000)))).toBe('6d ago')
    })

    it('returns "D Mon" format for dates 7 days or older', () => {
      // Exactly 7 days ago: 8 Jun
      expect(getRelativeTime(new Date(fixedNow.getTime() - 7 * 24 * 60 * 60 * 1000))).toBe('8 Jun')
      // 30 days ago: 16 May
      expect(getRelativeTime(new Date(fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000))).toBe('16 May')
      // 100 days ago: 7 Mar
      expect(getRelativeTime(new Date(fixedNow.getTime() - 100 * 24 * 60 * 60 * 1000))).toBe('7 Mar')
    })

    it('accepts string timestamps and numeric timestamps', () => {
      const tenMinutesAgo = new Date(fixedNow.getTime() - 10 * 60 * 1000)
      expect(getRelativeTime(tenMinutesAgo.toISOString())).toBe('10m ago')
      expect(getRelativeTime(tenMinutesAgo.getTime())).toBe('10m ago')
    })
  })
})
