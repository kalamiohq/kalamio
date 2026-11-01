// Helpers for a chat's on-screen message list, which is kept oldest-first.

/**
 * True when `newest` (page 1 from the server) shares nothing with what's on screen: more than a
 * full page arrived while the socket was down, so appending it would hide a hole in the history.
 */
export const hasHistoryGap = (current, newest) => {
    if (!current.length || !newest.length) return false;
    const onScreen = new Set(current.map((m) => m._id));
    return !newest.some((m) => onScreen.has(m._id));
};

/**
 * Merge page 1 into what's on screen: known messages take the fresh copy (it may carry a read
 * receipt we missed), unknown ones go on the end. A gap replaces the list instead.
 */
export const mergeNewestMessages = (current, newest) => {
    if (hasHistoryGap(current, newest)) return newest;
    const fresh = new Map(newest.map((m) => [m._id, m]));
    const onScreen = new Set(current.map((m) => m._id));
    return [
        ...current.map((m) => fresh.get(m._id) ?? m),
        ...newest.filter((m) => !onScreen.has(m._id)),
    ];
};

/** Append a message unless a reload after a reconnect already brought it in. */
export const appendMessage = (current, message) =>
    current.some((m) => m._id === message._id) ? current : [...current, message];
