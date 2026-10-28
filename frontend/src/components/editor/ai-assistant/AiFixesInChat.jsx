import { useMemo } from "react";
import AiProposalCard from "./AiProposalCard";
import { useSuggestionStatus, scrollToFix } from "./AiInlineSuggestion";
import { getAiSuggestion } from "../extensions/AiSuggestion";
import { editorAvailable, updateSuggestionEdits } from "../../../common/ai-editor";

/**
 * The review list for text fixes (spelling, grammar, small wording), shown in the chat. The fixes are
 * highlighted in place in the article (red original → green correction) by AiInlineSuggestion; editing
 * or unticking one here updates that highlight live, and "Apply Changes" applies them all as one step.
 */
const AiFixesInChat = ({ editor, message, busy, onApply, onCancel, onJump }) => {
    const { proposal } = message;
    const status = useSuggestionStatus(editor, proposal.id);

    // Re-opening the panel mid-review resumes from what the article shows (the author's edits so far).
    const initialFixes = useMemo(() => {
        const live = editorAvailable(editor) ? getAiSuggestion(editor.state) : null;
        return proposal.edits.map((e, i) => {
            const shown = live?.id === proposal.id ? live.edits?.[i] : null;
            return { find: e.find, replace: shown?.text ?? e.replace, enabled: shown ? shown.enabled : true };
        });
    }, [editor, proposal]);

    return (
        <AiProposalCard
            proposal={proposal}
            state={message.proposalState}
            removal={status}
            busy={busy}
            initialFixes={initialFixes}
            onFixesChange={(fixes) => updateSuggestionEdits(editor, proposal.id, fixes)}
            onFocusFix={(i) => { onJump?.(); scrollToFix(proposal.id, i); }}
            onApply={(fixes, edited) => onApply(message.id, fixes, edited)}
            onCancel={() => onCancel(message.id)}
        />
    );
};

export default AiFixesInChat;
