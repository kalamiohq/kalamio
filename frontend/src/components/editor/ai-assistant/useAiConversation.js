import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { streamAiChat, checkProposal } from "../../../common/ai-chat";
import { applyProposal as applyToEditor, articleText, captureEditorContext, editorAvailable } from "../../../common/ai-editor";

// Mirror the server's AI_LIMITS (server/validators/schemas.js) so requests are trimmed, not rejected.
const MESSAGE_CHARS = 8000;
const ARTICLE_TITLE_CHARS = 300;
const ARTICLE_CHARS = 60000;
const TOOL_RESULT_CHARS = 500;

let idSeq = 0;
const newId = () => `${Date.now().toString(36)}-${(++idSeq).toString(36)}`;

const usableReply = (m) => (m.status === "done" || m.status === "stopped") && Boolean(m.content || m.proposal);

/**
 * UI messages → what the server sees: only messages after the compaction point `through` (older ones
 * live in the summary), failed/blocked turns dropped, and each resolved proposal as a tool call
 * followed by its real outcome. The full list stays in the UI.
 */
export const toWireMessages = (messages, through) => {
    const list = messages.slice(through ? messages.findIndex(m => m.id === through) + 1 : 0);
    const wire = [];
    for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (m.role === "user") {
            const reply = list[i + 1];
            if (reply?.role === "assistant" && reply.status !== "streaming" && !usableReply(reply)) { i++; continue; }
            wire.push({ id: m.id, role: "user", content: m.content });
        } else if (m.role === "assistant") {
            if (!usableReply(m)) continue;
            const resolved = m.proposal && list[i + 1]?.role === "tool";
            wire.push({
                id: m.id, role: "assistant", content: m.content.slice(0, MESSAGE_CHARS),
                ...(resolved ? { toolCall: { id: m.proposal.id, operation: m.proposal.operation, target: m.proposal.target, ...(m.proposal.edits ? { edits: m.proposal.edits } : { content: m.proposal.content }) } } : {}),
            });
        } else {
            wire.push({ id: m.id, role: "tool", toolCallId: m.toolCallId, operation: m.operation, result: m.result });
        }
    }
    return wire;
};

const toolMessage = (msg, result) => ({
    id: newId(), role: "tool", toolCallId: msg.proposal.id, operation: msg.proposal.operation,
    result: { ...result, ...(result.message ? { message: result.message.slice(0, TOOL_RESULT_CHARS) } : {}) },
});

/**
 * Conversation state for the AI sidebar.
 *  • One reply at a time (send/approve are refused while a reply streams).
 *  • Context compaction is done by the server; this keeps `{ summary, through }` and only accepts a
 *    newer compaction point, so a late/duplicate event can never roll context back.
 *  • Proposals are applied ONLY via `approve` (the author's click), at most once each.
 *
 * Messages: { id, role: 'user', content }
 *         | { id, role: 'assistant', content, status, note?, notice?, proposal?, proposalState? }
 *         | { id, role: 'tool', toolCallId, operation, result }   (hidden in the UI)
 */
export const useAiConversation = ({ editor, title, provider, model }) => {
    const [messages, setMessagesState] = useState([]);
    const [context, setContextState] = useState(null);
    const [streaming, setStreaming] = useState(false);
    // Refs mirror state so async flows always read the latest values, synchronously.
    const messagesRef = useRef([]);
    const contextRef = useRef(null);
    const streamingRef = useRef(false);
    const abortRef = useRef(null);
    const handledRef = useRef(new Set()); // proposal ids already approved/cancelled
    // Bumped by reset() and on unmount. Async flows capture it and stop after an `await` if it changed,
    // so nothing from an old conversation (or a closed editor) applies changes or patches state.
    const sessionRef = useRef(0);
    const live = useRef({});
    live.current = { editor, title, provider, model };

    const setMessages = useCallback((updater) => {
        messagesRef.current = typeof updater === "function" ? updater(messagesRef.current) : updater;
        setMessagesState(messagesRef.current);
    }, []);
    const patch = useCallback((id, fn) => setMessages(list => list.map(m => (m.id === id ? { ...m, ...fn(m) } : m))), [setMessages]);

    // Leaving the editor stops any in-flight reply (and the provider tokens it would spend) and
    // invalidates any approval still waiting on the server check.
    useEffect(() => () => { sessionRef.current += 1; abortRef.current?.abort(); }, []);

    const acceptContext = (next) => {
        if (!next.summary) return; // compaction failed: keep the current summary + full history
        const indexOf = (id) => messagesRef.current.findIndex(m => m.id === id);
        if (contextRef.current && indexOf(next.through) <= indexOf(contextRef.current.through)) return;
        contextRef.current = { summary: next.summary, through: next.through };
        setContextState(contextRef.current);
    };

    const runTurn = async (newMessages) => {
        if (streamingRef.current) return false;
        streamingRef.current = true;
        setStreaming(true);
        const session = sessionRef.current;

        const { editor: ed, title: articleTitle, provider: prov, model: mdl } = live.current;
        const captured = captureEditorContext(ed);
        let text = "";
        try { text = editorAvailable(ed) ? articleText(ed) : ""; } catch { /* editor torn down — title only */ }

        const replyId = newId();
        setMessages(list => [...list, ...newMessages, { id: replyId, role: "assistant", content: "", status: "streaming" }]);
        const ctx = contextRef.current;
        const body = {
            messages: toWireMessages(messagesRef.current, ctx?.through),
            ...(ctx ? { context: ctx } : {}),
            article: {
                title: (articleTitle || "").slice(0, ARTICLE_TITLE_CHARS),
                text: text.slice(0, ARTICLE_CHARS),
                outline: captured.outline,
                selection: captured.selection,
            },
            provider: prov,
            model: mdl,
        };

        const controller = new AbortController();
        abortRef.current = controller;
        const result = await streamAiChat({
            body,
            signal: controller.signal,
            onDelta: (t) => patch(replyId, m => ({ content: m.content + t, note: null })),
            onStatus: (note) => patch(replyId, () => ({ note })),
            onNotice: (notice) => patch(replyId, () => ({ notice })),
            onContext: acceptContext,
            onProposal: (p) => patch(replyId, () => ({
                note: null,
                // `range` is client-only: where "cursor"/"selection" pointed when the author asked.
                proposal: { id: p.toolCallId, operation: p.operation, target: p.target, ...(p.edits ? { edits: p.edits } : { content: p.content }), range: captured.range },
                proposalState: { status: "pending" },
            })),
        });

        if (session !== sessionRef.current) return false; // reset/unmounted meanwhile (reset already cleared the flags)
        abortRef.current = null;
        streamingRef.current = false;
        setStreaming(false);
        if (result.status === "done") patch(replyId, () => ({ status: "done", note: null }));
        else if (result.status === "aborted") patch(replyId, () => ({ status: "stopped", note: null }));
        // blocked/error: discard partial text AND any proposal — nothing unvalidated stays actionable.
        else patch(replyId, () => ({ status: result.status, content: result.message, note: null, proposal: undefined, proposalState: undefined }));
        return true;
    };

    /** Send the author's message. A proposal still awaiting review is recorded as cancelled first. */
    const send = (raw) => {
        const content = raw.trim().slice(0, MESSAGE_CHARS);
        if (!content || streamingRef.current) return false;
        if (messagesRef.current.some(m => m.proposalState?.status === "checking")) {
            toast("Finish applying the proposed change first.");
            return false;
        }
        const superseded = messagesRef.current.filter(m => m.proposalState?.status === "pending" && !handledRef.current.has(m.proposal.id));
        const results = superseded.map((m) => {
            handledRef.current.add(m.proposal.id);
            patch(m.id, () => ({ proposalState: { status: "cancelled" } }));
            return toolMessage(m, { status: "cancelled", message: "The author sent a new message instead of applying this change." });
        });
        runTurn([...results, { id: newId(), role: "user", content }]);
        return true;
    };

    /**
     * The author clicked "Apply Changes". Re-check the (possibly edited) content on the server, apply it
     * through TipTap, then report the REAL outcome to the assistant. Repeated clicks/events are ignored.
     */
    const approve = async (messageId, html, edited = false) => {
        const msg = messagesRef.current.find(m => m.id === messageId);
        const proposal = msg?.proposal;
        if (!proposal || handledRef.current.has(proposal.id) || streamingRef.current) return;
        handledRef.current.add(proposal.id);
        const session = sessionRef.current;
        patch(messageId, () => ({ proposalState: { status: "checking" } }));

        // Text fixes: `html` is the reviewed fix list [{ find, replace, enabled }]; only enabled ones are checked.
        const checked = await checkProposal(proposal.operation === "edit"
            ? { operation: "edit", target: proposal.target, edits: html.filter(f => f.enabled).map(({ find, replace }) => ({ find, replace })) }
            : { operation: proposal.operation, target: proposal.target, content: html });
        // The chat was reset or the editor closed while the check ran: this approval is void.
        if (session !== sessionRef.current) return;
        if (!checked.ok) {
            // Not applied and not final: the author can edit and try again, or cancel.
            handledRef.current.delete(proposal.id);
            patch(messageId, () => ({ proposalState: { status: "pending", error: checked.message } }));
            return;
        }

        const ed = live.current.editor;
        const outcome = editorAvailable(ed)
            ? applyToEditor(ed, proposal, proposal.operation === "edit" ? html : checked.content)
            : { ok: false, message: "The article editor isn't available, so the change wasn't applied." };
        patch(messageId, () => ({ proposalState: { status: outcome.ok ? "applied" : "failed", error: outcome.ok ? null : outcome.message } }));
        if (outcome.ok) toast.success("Change applied to your article");
        await runTurn([toolMessage(msg, { status: outcome.ok ? "applied" : "failed", message: outcome.message, ...(outcome.ok ? { edited } : {}) })]);
    };

    /**
     * The author discarded the proposal. The article is untouched; the outcome joins the history —
     * as "failed" (with the reason) when it couldn't even be shown in the article.
     */
    const cancel = (messageId) => {
        const msg = messagesRef.current.find(m => m.id === messageId);
        if (!msg?.proposal || handledRef.current.has(msg.proposal.id)) return;
        handledRef.current.add(msg.proposal.id);
        const { unavailable, error } = msg.proposalState || {};
        patch(messageId, () => ({ proposalState: unavailable ? { status: "failed", error } : { status: "cancelled" } }));
        setMessages(list => [...list, toolMessage(msg, unavailable
            ? { status: "failed", message: error }
            : { status: "cancelled", message: "The author cancelled this change." })]);
    };

    /** Re-run a failed reply (the turn before it is unchanged). */
    const retry = (replyId) => {
        if (streamingRef.current) return;
        setMessages(list => list.filter(m => m.id !== replyId));
        runTurn([]);
    };

    const stop = () => abortRef.current?.abort();

    /** The proposal can't be shown in the article (e.g. its section is gone): keep it reviewable-but-unappliable. */
    const markUnavailable = useCallback((messageId, error) => {
        patch(messageId, (m) => (m.proposalState?.status === "pending" ? { proposalState: { status: "pending", error, unavailable: true } } : {}));
    }, [patch]);

    const reset = () => {
        sessionRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        streamingRef.current = false;
        setStreaming(false);
        setMessages([]);
        contextRef.current = null;
        setContextState(null);
        handledRef.current = new Set();
    };

    return { messages, context, streaming, send, approve, cancel, retry, stop, reset, markUnavailable };
};
