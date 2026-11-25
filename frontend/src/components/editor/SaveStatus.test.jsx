import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SaveStatus from './SaveStatus';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('SaveStatus', () => {
    // Local noon, so the date cases land on the same calendar day in any timezone.
    const now = new Date(2026, 10, 25, 12, 0, 0); // 25 Nov 2026 12:00

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        // [how long ago, expected label, ms ago]
        ['0s', 'just now', 0],
        ['4s', 'just now', 4 * SECOND],
        ['5s', '5s ago', 5 * SECOND],
        ['59s', '59s ago', 59 * SECOND],
        ['1m', '1m ago', MINUTE],
        ['59m 59s', '59m ago', 59 * MINUTE + 59 * SECOND],
        ['1h', '1h ago', HOUR],
        ['23h 59m', '23h ago', 23 * HOUR + 59 * MINUTE],
        ['1d', '1d ago', DAY],
        ['6d 23h', '6d ago', 6 * DAY + 23 * HOUR],
        ['7d', '18 Nov', 7 * DAY],
        // A draft last saved about a month ago used to read "Saved · 770h ago".
        ['770h', '24 Oct', 770 * HOUR],
    ])('saved %s ago reads "Saved · %s"', (_ago, label, ms) => {
        render(<SaveStatus status="saved" savedAt={now.getTime() - ms} />);

        expect(screen.getByText(`Saved · ${label}`)).toBeInTheDocument();
    });
});
