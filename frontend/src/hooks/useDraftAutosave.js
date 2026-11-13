// Debounced autosave of the editor's working state (Phase A local + Phase B server).
//
// Two layers, one status:
//   • LOCAL (always, ~0.7s): a snapshot to IndexedDB — the "never lose work" safety net that survives
//     refresh / close / crash / shutdown on this device.
//   • SERVER (existing drafts only, ~2s): pushes changes to the draft on the server so they're durable
//     and available on other devices. New posts stay local-only until the user commits; published posts
//     are never silently mutated.
//
// The visible status prefers the strongest guarantee that applies:
//   - local-only new post: "Saved" as soon as the local write lands (green).
//   - server-synced draft: "Saved" only once the SERVER confirms (green); "Saved on this device" (amber)
//     whenever the server is behind and we can't push right now — the server is unreachable/erroring, or
//     the draft currently can't be saved (no title). Transient failures retry with backoff and on
//     reconnect; nothing ever gets stuck on a spinner.

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveLocalDraft, deleteLocalDraft } from '../common/editor-local-store';

const LOCAL_DEBOUNCE_MS = 700;
const SERVER_DEBOUNCE_MS = 2000;
const SERVER_MAX_RETRIES = 6;

// Is there anything worth persisting? Guards against snapshotting a pristine, empty editor.
const hasBody = (content) => {
    const doc = Array.isArray(content) ? content[0] : content;
    if (!doc) return false;
    if (doc.type === 'doc') {
        const c = doc.content;
        return Array.isArray(c) && c.length > 0 &&
            !(c.length === 1 && c[0]?.type === 'paragraph' && !c[0]?.content);
    }
    if (doc.blocks) return Array.isArray(doc.blocks) && doc.blocks.length > 0;
    return false;
};

export const blogIsMeaningful = (b) =>
    Boolean(b && ((b.title && b.title.trim().length > 0) || hasBody(b.content)));

// Normalize the server's array-wrapped content ([{doc}]) to the editor's shape ({doc}) so signatures
// compare equal when the underlying content is the same.
const normContent = (content) => (Array.isArray(content) ? (content[0] ?? null) : (content ?? null));

// Stable content fingerprint used to detect real changes. Exported so editor.pages / blog-editor can
// compute the server's baseline consistently.
export const blogSignature = (b) => JSON.stringify({
    title: b?.title || '',
    des: b?.des || '',
    tags: b?.tags || [],
    banner: b?.banner || '',
    content: normContent(b?.content),
});

// The server draft-update endpoint requires a title, so only attempt a server save when one exists.
const canServerSave = (serverEnabled, b) =>
    serverEnabled && blogIsMeaningful(b) && Boolean(b?.title && b.title.trim().length > 0);

// The browser reports no network (e.g. Wi-Fi off). Used to show "offline" immediately and to skip a
// server attempt that would otherwise hang on timeouts (the request + the interceptor's token refresh).
const isBrowserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * @param {object}   args
 * @param {string}   args.draftKey         local storage key (`new:<username>` | `blog:<id>`)
 * @param {object}   args.blog             the live editor state from EditorContext
 * @param {boolean}  args.enabled          false until the editor has hydrated (post-load/restore)
 * @param {boolean}  args.serverEnabled    true only when editing an EXISTING draft (auto-sync to server)
 * @param {string}   args.serverContentSig signature of what the server currently holds (for existing drafts)
 * @param {Function} args.serverSave       async (blog) => void — pushes the draft to the server; throws on failure
 * @returns {{ saveStatus:'idle'|'saving'|'saved'|'offline', savedAt:number|null, clearLocalDraft:(key?:string)=>Promise<void> }}
 */
export const useDraftAutosave = ({ draftKey, blog, enabled, serverEnabled = false, serverContentSig = null, serverSave = null, hydratedSavedAt = null }) => {
    const [saveStatus, setSaveStatus] = useState('idle');
    const [savedAt, setSavedAt] = useState(null);

    const localBaselineRef = useRef(null);   // sig last written locally (null until hydrated)
    const serverBaselineRef = useRef(null);   // sig the server currently holds
    const savedAtRef = useRef(null);
    const serverErrorRef = useRef(null);      // null | 'transient' (network/5xx, retryable) | 'rejected' (4xx)

    const localTimerRef = useRef(null);
    const serverTimerRef = useRef(null);
    const serverRetryTimerRef = useRef(null);
    const serverRetryCountRef = useRef(0);
    const serverInFlightRef = useRef(false);
    const serverTrailingRef = useRef(false);  // a change landed while a server save was in flight

    const blogRef = useRef(blog);
    const keyRef = useRef(draftKey);
    const enabledRef = useRef(enabled);
    const serverEnabledRef = useRef(serverEnabled);
    const serverSaveRef = useRef(serverSave);
    blogRef.current = blog;
    keyRef.current = draftKey;
    enabledRef.current = enabled;
    serverEnabledRef.current = serverEnabled;
    serverSaveRef.current = serverSave;

    // Derive the visible status from the current refs. Called after every transition — it never leaves a
    // spinner running with nothing scheduled.
    const settle = useCallback(() => {
        const b = blogRef.current;
        if (serverInFlightRef.current) { setSaveStatus('saving'); return; }

        const meaningful = blogIsMeaningful(b);
        const sig = blogSignature(b);
        const serverEnabled = serverEnabledRef.current;
        const serverBehind = serverEnabled && sig !== serverBaselineRef.current;
        const canSave = canServerSave(serverEnabled, b);
        const localPending = meaningful && sig !== localBaselineRef.current;

        // Server is behind and we can't reconcile it right now — the browser is offline, the last push
        // failed, or it currently can't be pushed (no/empty title). Honest "saved on this device" (amber),
        // never a false green 'Saved' and never a stuck spinner. Checked BEFORE the empty-editor
        // short-circuit so clearing a server draft doesn't flash a stale green timestamp.
        if (serverBehind && (serverErrorRef.current || !canSave || isBrowserOffline())) { setSaveStatus('offline'); return; }
        // A local write, or a scheduled/attemptable server push, is still pending.
        if (localPending || (serverBehind && canSave)) { setSaveStatus('saving'); return; }
        // Nothing pending: 'saved' if there's content or a prior save to speak of, otherwise 'idle'.
        setSaveStatus(meaningful || savedAtRef.current ? 'saved' : 'idle');
    }, []);

    const snapshotOf = (key, b) => ({
        key,
        blog_id: b?.blog_id || null,
        title: b?.title || '',
        banner: b?.banner || '',
        content: b?.content ?? null,
        des: b?.des || '',
        tags: b?.tags || [],
        updatedAt: Date.now(),
        // The server signature this snapshot was written against. On another device, the load-time
        // reconcile uses it to tell genuine unsynced local edits (server still at this base) apart from
        // "the server moved on elsewhere" (base differs from the fetched server) — so a stale local copy
        // can never shadow newer server changes made on a different device/tab.
        baseServerSig: serverBaselineRef.current,
    });

    // ── Local write (safety net) ────────────────────────────────────────
    const localPersist = useCallback(async () => {
        const key = keyRef.current;
        const b = blogRef.current;
        if (!enabledRef.current || !key) return;
        if (!blogIsMeaningful(b)) {
            // The editor was emptied. If a snapshot was previously stored for this key, the user has
            // deliberately cleared their draft — drop that snapshot (and the "saved" timestamp) so the
            // removed content doesn't resurrect on refresh / reopen, and the indicator stops showing a
            // stale "Saved". deleteLocalDraft is a no-op when nothing was ever saved (a pristine new
            // post), so this is safe. localBaseline advances either way so we don't repeat this work on
            // every subsequent empty render.
            const clearedSig = blogSignature(b);
            if (localBaselineRef.current !== clearedSig) {
                await deleteLocalDraft(key);
                savedAtRef.current = null;
                setSavedAt(null);
            }
            localBaselineRef.current = clearedSig;
            settle();
            return;
        }
        const sig = blogSignature(b);
        if (sig !== localBaselineRef.current) {
            await saveLocalDraft(snapshotOf(key, b));
            localBaselineRef.current = sig;
            // The local write is the "saved" moment whenever the server won't persist this exact state
            // (a local-only new post, or a draft that currently can't be server-saved — e.g. no title).
            // When the server WILL save it, server confirmation drives savedAt instead.
            if (!canServerSave(serverEnabledRef.current, b)) {
                savedAtRef.current = Date.now();
                setSavedAt(savedAtRef.current);
            }
        }
        settle();
    }, [settle]);

    // ── Server write (durable, existing drafts only) ────────────────────
    const serverPersist = useCallback(async () => {
        if (serverInFlightRef.current) { serverTrailingRef.current = true; return; }
        const b = blogRef.current;
        const save = serverSaveRef.current;
        if (!enabledRef.current || !save || !canServerSave(serverEnabledRef.current, b)) return;
        const sig = blogSignature(b);
        if (sig === serverBaselineRef.current) return; // server already has this

        // Browser is offline: don't fire a request that would just hang on timeouts (and drag the token
        // interceptor with it). Flag it transient and let the 'online' listener retry on reconnect.
        if (isBrowserOffline()) { serverErrorRef.current = 'transient'; settle(); return; }

        serverInFlightRef.current = true;
        settle(); // -> saving
        try {
            await save(b);
            serverBaselineRef.current = sig;
            savedAtRef.current = Date.now();
            setSavedAt(savedAtRef.current);
            serverErrorRef.current = null;
            serverRetryCountRef.current = 0;
            clearTimeout(serverRetryTimerRef.current);

            // The content moved on while this save was in flight. Two things could lose those edits:
            //  - the change detector compared them with the baseline from BEFORE this save, so an edit
            //    back to it (an undo right after an autosave fired) looked like nothing to push;
            //  - their local snapshot names that old baseline as its base, so a reopen would read it as
            //    "the server moved on elsewhere" and drop it.
            // So queue a follow-up push, and re-stamp the local snapshot against what the server holds now.
            const current = blogRef.current;
            const currentSig = blogSignature(current);
            if (currentSig !== sig) {
                serverTrailingRef.current = true;
                if (keyRef.current && blogIsMeaningful(current)) {
                    await saveLocalDraft(snapshotOf(keyRef.current, current));
                    localBaselineRef.current = currentSig;
                }
            }
        } catch (err) {
            // Network / 5xx = transient → keep local, flag offline, retry with backoff (and on reconnect).
            // 4xx = rejected → the server won't accept this content (e.g. too large); don't hammer it,
            // just show the honest on-device state and let the next edit retry. Local is safe either way.
            const transient = !err?.response || err.response.status >= 500;
            serverErrorRef.current = transient ? 'transient' : 'rejected';
            if (transient && serverRetryCountRef.current < SERVER_MAX_RETRIES) {
                serverRetryCountRef.current += 1;
                const delay = Math.min(30000, SERVER_DEBOUNCE_MS * 2 ** (serverRetryCountRef.current - 1));
                clearTimeout(serverRetryTimerRef.current);
                serverRetryTimerRef.current = setTimeout(() => { serverPersist(); }, delay);
            }
        } finally {
            serverInFlightRef.current = false;
            settle();
            if (serverTrailingRef.current) {
                serverTrailingRef.current = false;
                clearTimeout(serverTimerRef.current);
                serverTimerRef.current = setTimeout(serverPersist, SERVER_DEBOUNCE_MS);
            }
        }
    }, [settle]);

    // Adopt a new server baseline when the edited draft's identity changes in place (an in-app draft
    // switch via loadDraft updates serverContentSig without remounting) — so switching drafts never
    // re-uploads unchanged content or stamps an untouched draft `edited`.
    useEffect(() => {
        if (serverContentSig != null) serverBaselineRef.current = serverContentSig;
    }, [serverContentSig]);

    // ── Change detection → schedule debounced writes ────────────────────
    useEffect(() => {
        if (!enabled) return;

        // First render after hydration: adopt baselines, don't save. serverBaseline is what the server
        // holds — if we restored newer local edits, sig differs from it and a push fires below.
        if (localBaselineRef.current === null) {
            const sig = blogSignature(blog);
            localBaselineRef.current = sig;
            serverBaselineRef.current = serverContentSig != null ? serverContentSig : sig;
            // Reflect the already-saved state immediately on reopen (don't leave the indicator blank until
            // the first edit). If restored local edits are newer than the server, settle() below shows
            // 'saving' while the push fires.
            if (blogIsMeaningful(blog) && hydratedSavedAt) {
                savedAtRef.current = hydratedSavedAt;
                setSavedAt(hydratedSavedAt);
            }
            if (serverEnabledRef.current && sig !== serverBaselineRef.current && canServerSave(serverEnabledRef.current, blog)) {
                clearTimeout(serverTimerRef.current);
                serverTimerRef.current = setTimeout(serverPersist, SERVER_DEBOUNCE_MS);
            }
            settle();
            return;
        }

        const sig = blogSignature(blog);
        const localPending = sig !== localBaselineRef.current;
        const serverPending = canServerSave(serverEnabledRef.current, blog) && sig !== serverBaselineRef.current;
        if (!localPending && !serverPending) { settle(); return; }

        if (localPending) {
            clearTimeout(localTimerRef.current);
            localTimerRef.current = setTimeout(localPersist, LOCAL_DEBOUNCE_MS);
        }
        if (serverPending) {
            // Fresh content → fresh attempt: clear any prior error and pending retry so the status
            // reflects a new save in progress rather than a stale failure.
            serverErrorRef.current = null;
            serverRetryCountRef.current = 0;
            clearTimeout(serverRetryTimerRef.current);
            clearTimeout(serverTimerRef.current);
            serverTimerRef.current = setTimeout(serverPersist, SERVER_DEBOUNCE_MS);
        }
        settle();
        return () => {
            clearTimeout(localTimerRef.current);
            clearTimeout(serverTimerRef.current);
        };
    }, [blog, enabled, serverContentSig, hydratedSavedAt, localPersist, serverPersist, settle]);

    // Retry the server sync as soon as connectivity returns (covers the network-drop case; 5xx errors
    // are handled by the backoff timer above since they don't fire an 'online' event).
    useEffect(() => {
        if (!enabled) return;
        const onOnline = () => {
            // Reconnected: if the server is behind on this draft (a prior transient failure, or edits made
            // while offline), push now.
            const b = blogRef.current;
            const behind = canServerSave(serverEnabledRef.current, b) && blogSignature(b) !== serverBaselineRef.current;
            if (behind) {
                clearTimeout(serverRetryTimerRef.current);
                serverPersist();
            }
        };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [enabled, serverPersist]);

    // Best-effort local flush of the last keystrokes when the tab is hidden or torn down. (Server sync
    // relies on the debounce + on-reopen restore-and-push; local is the reliable last-gasp write.)
    useEffect(() => {
        if (!enabled) return;
        const flush = () => { clearTimeout(localTimerRef.current); localPersist(); };
        const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', flush);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', flush);
        };
    }, [enabled, localPersist]);

    // Clear every pending timer on unmount so a scheduled write or backoff retry can't fire (and POST)
    // after the editor is gone.
    useEffect(() => () => {
        clearTimeout(localTimerRef.current);
        clearTimeout(serverTimerRef.current);
        clearTimeout(serverRetryTimerRef.current);
    }, []);

    // Called once work is safely committed to the server (publish / manual save-as-draft).
    const clearLocalDraft = useCallback(async (key = keyRef.current) => {
        const sig = blogSignature(blogRef.current);
        localBaselineRef.current = sig;
        serverBaselineRef.current = sig;
        savedAtRef.current = null;
        serverErrorRef.current = null;
        serverRetryCountRef.current = 0;
        serverTrailingRef.current = false;
        clearTimeout(serverRetryTimerRef.current);
        setSaveStatus('idle');
        setSavedAt(null);
        if (key) await deleteLocalDraft(key);
    }, []);

    return { saveStatus, savedAt, clearLocalDraft };
};
