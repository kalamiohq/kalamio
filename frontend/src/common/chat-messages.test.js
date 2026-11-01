import { describe, it, expect } from 'vitest';
import { appendMessage, hasHistoryGap, mergeNewestMessages } from './chat-messages';

const msg = (id, extra = {}) => ({ _id: id, ...extra });

describe('hasHistoryGap', () => {
  it('is false when the page overlaps what is on screen', () => {
    expect(hasHistoryGap([msg('a'), msg('b')], [msg('b'), msg('c')])).toBe(false);
  });

  it('is true when the page shares nothing with what is on screen', () => {
    expect(hasHistoryGap([msg('a'), msg('b')], [msg('x'), msg('y')])).toBe(true);
  });

  it('is false when either side is empty', () => {
    expect(hasHistoryGap([], [msg('a')])).toBe(false);
    expect(hasHistoryGap([msg('a')], [])).toBe(false);
  });
});

describe('mergeNewestMessages', () => {
  it('adds unknown messages to the end, keeping older history', () => {
    const merged = mergeNewestMessages([msg('a'), msg('b')], [msg('b'), msg('c')]);
    expect(merged.map((m) => m._id)).toEqual(['a', 'b', 'c']);
  });

  it('takes the fresh copy of a known message, so missed read receipts land', () => {
    const merged = mergeNewestMessages(
      [msg('a', { read: false })],
      [msg('a', { read: true })],
    );
    expect(merged).toEqual([msg('a', { read: true })]);
  });

  it('is a no-op in content when nothing changed', () => {
    const current = [msg('a'), msg('b')];
    expect(mergeNewestMessages(current, [msg('a'), msg('b')])).toEqual(current);
  });

  it('replaces the list across a gap, instead of hiding the hole', () => {
    const merged = mergeNewestMessages([msg('a')], [msg('x'), msg('y')]);
    expect(merged.map((m) => m._id)).toEqual(['x', 'y']);
  });
});

describe('appendMessage', () => {
  it('appends a new message', () => {
    expect(appendMessage([msg('a')], msg('b')).map((m) => m._id)).toEqual(['a', 'b']);
  });

  it('skips a message a reload already brought in', () => {
    const current = [msg('a'), msg('b')];
    expect(appendMessage(current, msg('b'))).toBe(current);
  });
});
