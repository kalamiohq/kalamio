import { io } from 'socket.io-client';
import { lookInSession } from './session';
import { queryKeys } from './queryKeys';
import { queryClient } from './queryClient';
import { ensureFreshToken } from './api';

// ── When the socket is open ─────────────────────────────────────────────────
// A WebSocket is a single long-lived request: while it's open Cloud Run keeps the instance alive and
// BILLED at the full rate, on the API AND on the web service's nginx proxy in front of it, and
// min-instances=0 can never scale to zero (a held socket is never "idle"). So one forgotten tab pins
// both services 24/7, at about 100x the cost of the polling it would replace.
//
// So nothing opens it at login. Badges and article counts poll every 60s, and only a screen that
// needs live delivery (Messages) holds the socket, via acquireSocket / releaseSocket. Even then it
// closes while the tab is hidden or the user has stopped touching it. socket.disconnect() keeps the
// instance and its listeners, so reopening is seamless.
const RELEASE_GRACE_MS = 30_000;       // the last screen left: ride out in-app navigation
const HIDDEN_GRACE_MS = 60_000;        // ride out quick tab-switches; only close a genuinely-away tab
const IDLE_CLOSE_MS = 10 * 60_000;     // a visible tab with nobody at it is still a forgotten tab

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

let socket = null;

let holders = 0;           // mounted screens that currently need the socket
let hiddenAway = false;    // the tab has been hidden for longer than HIDDEN_GRACE_MS
let idleAway = false;      // no input for IDLE_CLOSE_MS
let lastActivityAt = 0;

let releaseTimer = null;
let idleTimer = null;

const shouldBeOpen = () => holders > 0 && !hiddenAway && !idleAway;

// Bring the socket in line with shouldBeOpen(). Timers and events only update the state above and call
// this, so the error / online reconnect paths can't quietly reopen a socket that was closed on purpose.
const syncSocket = () => {
    if (!socket) return;
    if (shouldBeOpen()) {
        if (!socket.connected && lookInSession("user")) socket.connect(); // the auth fn fetches a fresh token
    } else if (socket.connected || socket.active) {
        socket.disconnect();
    }
};

const armIdleTimer = (delay = IDLE_CLOSE_MS) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
        const quietFor = Date.now() - lastActivityAt;
        if (quietFor < IDLE_CLOSE_MS) {
            armIdleTimer(IDLE_CLOSE_MS - quietFor);
            return;
        }
        idleAway = true;
        syncSocket();
    }, delay);
};

const markActive = () => {
    lastActivityAt = Date.now();
    if (!idleAway) return;
    idleAway = false;
    if (holders > 0) armIdleTimer();
    syncSocket();
};

const resumeLiveQueries = () => {
    // The 60s poll on these queries is paused while the tab is hidden, so refetch once on return
    // (arrivals AND removals) instead of making the user wait for the next poll tick.
    queryClient.invalidateQueries({ queryKey: queryKeys.messages.unreadTotal() });
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unread() });
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
};

if (typeof window !== "undefined") {
    // Proactively reconnect a dropped socket the moment the network returns — snappier than waiting
    // for the next backoff retry. connect() is a no-op on an already-connected socket, so this is safe.
    window.addEventListener("online", () => {
        if (!shouldBeOpen()) return; // closed on purpose: stays closed until something wants it again
        if (socket && !socket.connected) socket.connect();
    });

    ACTIVITY_EVENTS.forEach((type) => {
        window.addEventListener(type, markActive, { passive: true, capture: true });
    });

    let hiddenTimer = null;

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            if (hiddenTimer || hiddenAway) return;
            hiddenTimer = setTimeout(() => {
                hiddenTimer = null;
                // Re-check: the tab may have returned during the grace window.
                if (document.visibilityState !== "hidden") return;
                hiddenAway = true;
                syncSocket();
            }, HIDDEN_GRACE_MS);
        } else {
            if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
            if (!hiddenAway) return; // never went away: nothing to resume
            hiddenAway = false;
            markActive();
            syncSocket();
            resumeLiveQueries(); // catch up on whatever arrived while we were away
        }
    });
}

/**
 * Socket events invalidate the relevant queries rather than fetching directly — TanStack Query decides
 * whether to refetch based on whether any component is currently observing that query.
 */
const bridgeToQueryCache = (sock) => {
    sock.on('new_message', () => {
        // The unread-total badge query IS a React Query; the conversation list is local state on the
        // messages page (refreshed by its own new_message listener), so we don't invalidate it here.
        queryClient.invalidateQueries({ queryKey: queryKeys.messages.unreadTotal() });
    });

    sock.on('new_notification', () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.unread() });
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
    });
};

// Create the single Socket.IO instance, closed: syncSocket decides when it opens. Uses the JWT from
// session for authentication.
const ensureSocket = () => {
    // Reuse the single instance whatever its state (connecting / connected / reconnecting / closed).
    if (socket) return socket;

    const user = lookInSession("user");
    if (!user) return null;

    const { access_token } = JSON.parse(user);
    if (!access_token) return null;

    const serverUrl = import.meta.env.VITE_SERVER_DOMAIN || 'http://localhost:8080';

    socket = io(serverUrl, {
        autoConnect: false,
        // auth as a FUNCTION: called on EVERY connection attempt (initial + all reconnects), so each
        // handshake carries a guaranteed-fresh access token. Access tokens only live 15 minutes and
        // the session persists in localStorage for days, so a page load usually starts with an
        // expired token — ensureFreshToken() refreshes it (single-flight, shared with axios) before
        // the socket ever presents it, instead of getting rejected and needing recovery.
        auth: (cb) => {
            ensureFreshToken()
                .then((token) => {
                    if (token) return cb({ token });
                    // No refreshable session — fall back to whatever is stored (server will reject,
                    // and the connect_error recovery below retries with backoff).
                    const u = lookInSession("user");
                    try { cb({ token: u ? JSON.parse(u).access_token : '' }); } catch { cb({ token: '' }); }
                })
                .catch(() => cb({ token: '' }));
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        // Never give up: socket.io keeps retrying with a capped (~5s) backoff, so real-time recovers
        // whenever connectivity returns. A finite cap would leave the socket permanently dead after a
        // long outage (laptop sleep, tunnel, VPN drop), since the single instance is reused.
        reconnectionAttempts: Infinity
    });

    // Auth-rejection recovery. When the server's socket middleware rejects the handshake, Socket.IO
    // does NOT auto-reconnect: socket.active === false and the manager never schedules a retry, so
    // without this the socket would stay dead for the whole visit. Retrying re-runs the auth
    // function above, which refreshes the token — so this recovers from any transient auth failure.
    // Backoff caps the retries when the session is truly dead (user must re-login).
    let authRetry = 0;

    socket.on('connect', () => {
        authRetry = 0;
        console.log('[Socket] Connected:', socket.id);
    });

    socket.on('connect_error', (err) => {
        console.warn('[Socket] Connection error:', err.message);
        if (socket.active) return; // transport-level failure — the manager auto-reconnects
        const delay = Math.min(60_000, 2_000 * 2 ** Math.min(authRetry++, 5));
        setTimeout(() => {
            if (!socket || socket.connected) return; // disconnected via logout, or already recovered
            if (!shouldBeOpen()) return;             // closed on purpose since — stay closed
            if (!lookInSession("user")) return;      // logged out — nothing to reconnect with
            socket.connect(); // the auth function fetches a fresh token for this attempt
        }, delay);
    });

    bridgeToQueryCache(socket);

    return socket;
};

/**
 * Hold the socket open for a screen that needs live delivery. Pair every successful call with
 * releaseSocket(), typically in a useEffect cleanup.
 *
 * @returns {import('socket.io-client').Socket|null} The socket, or null when signed out.
 */
export const acquireSocket = () => {
    const sock = ensureSocket();
    if (!sock) return null;

    clearTimeout(releaseTimer);
    releaseTimer = null;

    if (holders++ === 0) {
        // Opening a screen that wants the socket counts as activity.
        lastActivityAt = Date.now();
        idleAway = false;
        armIdleTimer();
    }
    syncSocket();
    return sock;
};

/**
 * Give back a hold from acquireSocket(). The last one closes the socket after a short grace.
 */
export const releaseSocket = () => {
    holders = Math.max(0, holders - 1);
    if (holders > 0 || !socket) return;

    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
        releaseTimer = null;
        clearTimeout(idleTimer);
        syncSocket();
    }, RELEASE_GRACE_MS);
};

/**
 * The current socket, or null. This never opens anything: use it to emit from a screen that already
 * holds the socket through acquireSocket().
 */
export const getSocket = () => socket;

/**
 * Disconnect and clean up socket.
 */
export const disconnectSocket = () => {
    clearTimeout(releaseTimer);
    clearTimeout(idleTimer);
    releaseTimer = null;
    holders = 0;
    if (socket) {
        socket.disconnect();
        socket = null;
    }
};

export default getSocket;
