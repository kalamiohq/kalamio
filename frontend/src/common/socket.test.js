import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A mutable holder the io() mock returns, swapped fresh per test. vi.hoisted so the (hoisted)
// vi.mock factory can reference it.
const h = vi.hoisted(() => ({ current: null }));

const makeFakeSocket = () => ({
  id: 'sock-' + Math.random().toString(36).slice(2, 6),
  connected: false,
  active: false,
  on: vi.fn(),
  connect: vi.fn(function () { this.connected = true; }),
  disconnect: vi.fn(function () { this.connected = false; }),
});

// Created with autoConnect: false, so a fresh socket starts closed, like the real client.
vi.mock('socket.io-client', () => ({ io: vi.fn(() => h.current) }));
vi.mock('./api', () => ({ ensureFreshToken: vi.fn(() => Promise.resolve('tok')) }));
vi.mock('./session', () => ({
  lookInSession: vi.fn(() => JSON.stringify({ access_token: 'tok', refresh_token: 'r' })),
}));
vi.mock('./queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));

// Imported once → the visibility/online/activity listeners register a single time on jsdom's document/window.
import { acquireSocket, releaseSocket, getSocket, disconnectSocket } from './socket';
import { lookInSession } from './session';
import { queryClient } from './queryClient';

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
};

const RELEASE_GRACE = 30_000;
const HIDDEN_GRACE = 60_000;
const IDLE_CLOSE = 10 * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  h.current = makeFakeSocket();
  setVisibility('visible');
  vi.clearAllMocks(); // resetting visibility can refetch the badges; that must not count for the test
});

afterEach(() => {
  disconnectSocket();       // null the module socket so the next test starts clean
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('socket on demand', () => {
  it('opens nothing until a screen acquires it', () => {
    expect(getSocket()).toBeNull();

    const socket = acquireSocket();
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(true);
    expect(getSocket()).toBe(socket);
  });

  it('returns null when signed out, and leaves nothing held', () => {
    lookInSession.mockReturnValueOnce(null);
    expect(acquireSocket()).toBeNull();

    // A later real acquire + release still closes, so the failed call wasn't counted as a hold.
    const socket = acquireSocket();
    releaseSocket();
    vi.advanceTimersByTime(RELEASE_GRACE);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stays open while any screen holds it, and closes after a grace once the last one leaves', () => {
    const socket = acquireSocket();
    acquireSocket();

    releaseSocket();
    vi.advanceTimersByTime(RELEASE_GRACE);
    expect(socket.disconnect).not.toHaveBeenCalled();

    releaseSocket();
    vi.advanceTimersByTime(RELEASE_GRACE - 1);
    expect(socket.disconnect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(false);
  });

  it('does NOT close when another screen acquires within the grace (no churn on navigation)', () => {
    const socket = acquireSocket();

    releaseSocket();
    vi.advanceTimersByTime(RELEASE_GRACE / 2);
    acquireSocket();
    vi.advanceTimersByTime(RELEASE_GRACE);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('reopens the same instance on the next acquire, keeping its listeners', () => {
    const socket = acquireSocket();
    releaseSocket();
    vi.advanceTimersByTime(RELEASE_GRACE);
    expect(socket.connected).toBe(false);

    expect(acquireSocket()).toBe(socket);
    expect(socket.connect).toHaveBeenCalledTimes(2);
    expect(socket.connected).toBe(true);
  });

  it('stays closed after release when the network returns', () => {
    const socket = acquireSocket();
    releaseSocket();
    vi.advanceTimersByTime(RELEASE_GRACE);

    socket.connect.mockClear();
    window.dispatchEvent(new Event('online'));
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('logout closes at once and cancels a pending release', () => {
    const socket = acquireSocket();
    releaseSocket();
    disconnectSocket();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(getSocket()).toBeNull();

    vi.advanceTimersByTime(RELEASE_GRACE);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('a screen cleaning up after logout does not break the next session', () => {
    acquireSocket();
    disconnectSocket();
    releaseSocket(); // late cleanup, with nothing held

    h.current = makeFakeSocket();
    const next = acquireSocket();
    vi.advanceTimersByTime(RELEASE_GRACE);
    expect(next.connected).toBe(true); // still held: the stray release didn't eat this hold
  });

  it('wires incoming events to the query cache', () => {
    const socket = acquireSocket();
    const handler = (event) => socket.on.mock.calls.find(([name]) => name === event)[1];

    handler('new_notification')();
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);

    queryClient.invalidateQueries.mockClear();
    handler('new_message')();
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1);
  });
});

describe('socket idle close', () => {
  it('closes after 10 minutes with no input, even on a visible tab', () => {
    const socket = acquireSocket();

    vi.advanceTimersByTime(IDLE_CLOSE - 1);
    expect(socket.disconnect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('input pushes the idle close back', () => {
    const socket = acquireSocket();

    vi.advanceTimersByTime(IDLE_CLOSE - 1000);
    window.dispatchEvent(new Event('pointermove'));

    vi.advanceTimersByTime(IDLE_CLOSE - 1);
    expect(socket.disconnect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('the next input reopens it, and the idle close applies again', () => {
    const socket = acquireSocket();
    vi.advanceTimersByTime(IDLE_CLOSE);
    expect(socket.connected).toBe(false);

    socket.connect.mockClear();
    window.dispatchEvent(new Event('keydown'));
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(true);

    socket.disconnect.mockClear();
    vi.advanceTimersByTime(IDLE_CLOSE);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('input does not open a socket nobody holds', () => {
    const socket = acquireSocket();
    releaseSocket();
    vi.advanceTimersByTime(RELEASE_GRACE);

    socket.connect.mockClear();
    window.dispatchEvent(new Event('keydown'));
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('stays closed when the network returns while idle', () => {
    const socket = acquireSocket();
    vi.advanceTimersByTime(IDLE_CLOSE);

    socket.connect.mockClear();
    window.dispatchEvent(new Event('online'));
    expect(socket.connect).not.toHaveBeenCalled();
  });
});

describe('socket tab-visibility power saver', () => {
  it('closes the socket after the grace period once hidden, and reopens + refetches on return', () => {
    const socket = acquireSocket();
    socket.connect.mockClear();

    setVisibility('hidden');
    // Not closed immediately — rides out quick tab-switches.
    vi.advanceTimersByTime(HIDDEN_GRACE - 1);
    expect(socket.disconnect).not.toHaveBeenCalled();

    // Grace elapsed while still hidden → idle-close.
    vi.advanceTimersByTime(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(false);

    // Back to foreground → reconnect + catch-up refetch of the live badges.
    setVisibility('visible');
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(true);
    expect(queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('does NOT close on a quick hide→show within the grace window (no churn)', () => {
    const socket = acquireSocket();
    socket.connect.mockClear();

    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE / 2);
    setVisibility('visible');              // returned before the grace elapsed
    vi.advanceTimersByTime(HIDDEN_GRACE);  // the pending timer must have been cancelled

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled(); // nothing to resume — was never closed
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('stays closed while hidden — an online event must not silently reopen a backgrounded tab', () => {
    const socket = acquireSocket();

    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);

    socket.connect.mockClear();
    window.dispatchEvent(new Event('online')); // network blip while backgrounded
    expect(socket.connect).not.toHaveBeenCalled(); // suppressed until the tab is shown again
  });

  it('refetches the badges on return even with no socket, since their poll paused while hidden', () => {
    expect(getSocket()).toBeNull();

    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_GRACE);
    setVisibility('visible');

    expect(queryClient.invalidateQueries).toHaveBeenCalled();
    expect(getSocket()).toBeNull(); // catching up must not open a socket
  });

  it('coming back from a hidden tab that also went idle reopens the socket', () => {
    const socket = acquireSocket();

    setVisibility('hidden');
    vi.advanceTimersByTime(IDLE_CLOSE);
    expect(socket.connected).toBe(false);

    socket.connect.mockClear();
    setVisibility('visible');
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(true);
  });
});
