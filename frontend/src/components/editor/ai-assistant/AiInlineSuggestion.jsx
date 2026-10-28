import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AiProposalCard from "./AiProposalCard";
import { getAiSuggestion } from "../extensions/AiSuggestion";
import { showSuggestion, clearSuggestion, countNonText, editorAvailable } from "../../../common/ai-editor";

const EMPTY_STATUS = { stale: false, counts: {}, fixes: [] };

/**
 * Follow a suggestion's live state as the author edits: did its target get deleted? Does the range it
 * would remove contain images/tables/embeds? Can each text fix still be found? Shared by the in-article
 * card and the chat's fix list.
 */
export const useSuggestionStatus = (editor, proposalId) => {
    const [status, setStatus] = useState(EMPTY_STATUS);
    useEffect(() => {
        if (!editorAvailable(editor)) return undefined;
        const update = () => {
            const s = editorAvailable(editor) ? getAiSuggestion(editor.state) : null;
            if (s?.id !== proposalId) return;
            const next = {
                stale: Boolean(s.stale),
                counts: s.at === undefined ? countNonText(editor.state.doc, s.from, s.to) : {},
                fixes: (s.edits || []).map(e => ({ found: e.found, stale: Boolean(e.stale) })),
            };
            setStatus(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        };
        update();
        editor.on("transaction", update);
        return () => editor.off("transaction", update);
    }, [editor, proposalId]);
    return status;
};

/** Scroll the article to text fix `index` of a proposal (or its first fix). */
export const scrollToFix = (proposalId, index = 0) => {
    const el = document.querySelector(`[data-ai-fix="${proposalId}-${index}"]`) || document.querySelector(`[data-ai-fix^="${proposalId}-"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
};

/**
 * Shows a pending proposal INSIDE the article: the AiSuggestion extension highlights what would be
 * removed (red) and what would be added (green). Content changes get an editable card portalled into a
 * widget at the target; text fixes are only highlighted here and reviewed/approved from the chat
 * (AiFixesInChat). Rendered outside the sidebar, so highlights stay while the panel is closed.
 */
const AiInlineSuggestion = ({ editor, message, busy, onApply, onCancel, onUnavailable }) => {
    const { proposal } = message;
    const isFixes = proposal.operation === "edit";
    const dom = useMemo(() => {
        if (isFixes) return null;
        const el = document.createElement("div");
        el.className = "ai-suggestion-widget";
        el.id = `ai-suggestion-${proposal.id}`;
        el.contentEditable = "false"; // the nested preview editor is its own editing host
        return el;
    }, [proposal.id, isFixes]);
    const [shown, setShown] = useState(false);
    const unavailable = useRef(onUnavailable);
    unavailable.current = onUnavailable;
    const status = useSuggestionStatus(shown ? editor : null, proposal.id);

    // Show it in the article; hide it once resolved, on chat reset, or when the panel unmounts.
    useEffect(() => {
        if (!editorAvailable(editor)) {
            unavailable.current(message.id, "The article editor isn't available right now.");
            return undefined;
        }
        const result = showSuggestion(editor, proposal, proposal.range, dom);
        if (!result.ok) {
            unavailable.current(message.id, result.error);
            return undefined;
        }
        setShown(true);
        requestAnimationFrame(() => (dom ? dom.scrollIntoView?.({ block: "center", behavior: "smooth" }) : scrollToFix(proposal.id)));
        return () => clearSuggestion(editor, proposal.id);
    }, [editor, proposal, message.id, dom]);

    if (!shown || isFixes) return null;
    return createPortal(
        <AiProposalCard
            proposal={proposal}
            state={message.proposalState}
            removal={status}
            busy={busy}
            onApply={(html, edited) => onApply(message.id, html, edited)}
            onCancel={() => onCancel(message.id)}
        />,
        dom,
    );
};

export default AiInlineSuggestion;
