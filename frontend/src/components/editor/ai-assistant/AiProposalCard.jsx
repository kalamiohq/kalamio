import { useEffect, useId, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Icon from "../../Icon";
import { describeTarget, describeCounts } from "../../../common/ai-editor";

const OPERATION_LABEL = { insert: "Insert", append: "Append", replace: "Replace", edit: "Fix text" };

/**
 * Inline review of an article change the assistant PROPOSED, rendered inside the article itself (see
 * AiInlineSuggestion + the AiSuggestion extension): the proposed content is an editable green block
 * at the exact spot it would land, and anything it would remove is highlighted red in the article.
 * Nothing changes until the author clicks "Apply" (the parent then re-checks it on the server and
 * applies it through TipTap). The model's tool call is never treated as approval.
 *
 * Chrome uses div/span (not p/h*) so the article's typography doesn't restyle it; the editable
 * preview deliberately DOES look like article text.
 *
 * Props:
 *   proposal  — { id, operation, target, content }
 *   state     — { status: 'pending'|'checking'|'applied'|'failed'|'cancelled', error? }
 *   removal   — { stale, counts } live from the editor: target deleted? non-text nodes it would remove?
 *   busy      — another reply is streaming; approval waits
 *   onApply(html, edited) / onCancel()
 */
const AiProposalCard = ({ proposal, state, removal = { stale: false, counts: {}, fixes: [] }, busy = false, onApply, onCancel, onFixesChange, initialFixes, onFocusFix }) => {
    const uid = useId();
    const [html, setHtml] = useState(proposal.content);
    const [empty, setEmpty] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const edited = useRef(false);
    const pending = state.status === "pending";
    const replacing = proposal.operation === "replace";
    const replacingAll = proposal.target.type === "entire_article";
    const alsoRemoves = describeCounts(removal.counts);

    // Text fixes (operation "edit"): a reviewable list instead of a rich-text preview, shown in the chat
    // (AiFixesInChat). Each fix is also highlighted in place in the article and follows edits made here.
    const isFixes = proposal.operation === "edit";
    const [fixes, setFixes] = useState(() => initialFixes || (proposal.edits || []).map(e => ({ find: e.find, replace: e.replace, enabled: true })));
    const fixStatus = removal.fixes || [];
    const usableFix = (f, i) => f.enabled && fixStatus[i]?.found !== false && !fixStatus[i]?.stale;
    const updateFix = (i, change) => {
        edited.current = true;
        const next = fixes.map((f, j) => (j === i ? { ...f, ...change } : f));
        setFixes(next);
        onFixesChange?.(next);
    };

    // The editable preview: a small TipTap editor, styled as green "added" text.
    const editor = useEditor({
        extensions: [StarterKit, Underline, Link.configure({ openOnClick: false, autolink: false })],
        content: proposal.content,
        editable: pending,
        editorProps: {
            attributes: {
                class: "ai-suggestion-insert outline-none px-3.5 py-2.5 min-h-[48px]",
                "aria-labelledby": `${uid}-label`,
                "aria-multiline": "true",
                role: "textbox",
            },
        },
        onUpdate: ({ editor: e }) => {
            edited.current = true;
            setHtml(e.getHTML());
            setEmpty(!e.getText().trim());
        },
    });
    // emitUpdate=false: TipTap's setEditable fires `update` by default, which would mark it "edited".
    useEffect(() => { editor?.setEditable(pending, false); }, [editor, pending]);

    const problem = isFixes
        ? (fixes.some(usableFix) ? null : fixes.some(f => f.enabled) ? "The text these fixes target has changed. Cancel this and ask again." : "Select at least one fix, or cancel.")
        : empty ? "Add some content, or cancel." : removal.stale ? "The text this was going to replace has been deleted. Cancel this and ask again." : null;
    const canApply = pending && !busy && !problem && (!replacingAll || confirmed);

    return (
        <div role="group" aria-labelledby={`${uid}-label`} className="ai-suggestion-card my-2 overflow-hidden rounded-radius-md border border-border bg-white shadow-sm">
            {/* `ai-suggestion-chrome` opts the labels/buttons out of the article's serif typography (index.css). */}
            <div id={`${uid}-label`} className="ai-suggestion-chrome flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border px-3.5 py-2 font-sans text-[13px] leading-5 text-dark-grey">
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium tracking-wide text-success">
                    <Icon name="smart_toy" className="text-[12px]" /> AI suggestion
                </span>
                <span className={`font-medium ${replacingAll ? "text-red" : "text-black"}`}>
                    {replacingAll ? "Replace entire draft" : OPERATION_LABEL[proposal.operation]}
                </span>
                <span>· {isFixes ? `${fixes.length} fix${fixes.length === 1 ? "" : "es"}, shown in place in your article` : describeTarget(proposal.target)}</span>
            </div>

            {isFixes ? (
                <ul className="ai-suggestion-chrome flex flex-col divide-y divide-border font-sans text-[13px] leading-5">
                    {fixes.map((f, i) => {
                        const missing = fixStatus[i]?.found === false;
                        const changed = fixStatus[i]?.stale;
                        return (
                            <li key={i} className={`flex items-center gap-2 px-3.5 py-2 ${missing ? "opacity-50" : ""}`}>
                                <input type="checkbox" className="h-3.5 w-3.5 shrink-0 accent-success"
                                    checked={f.enabled && !missing} disabled={!pending || missing}
                                    onChange={(e) => updateFix(i, { enabled: e.target.checked })}
                                    aria-label={`Apply the fix for “${f.find}”`} />
                                {onFocusFix && !missing ? (
                                    <button type="button" onClick={() => onFocusFix(i)} title={`Show “${f.find}” in the article`}
                                        className="min-w-0 max-w-[40%] truncate text-left text-red line-through decoration-red/60 hover:opacity-75">
                                        {f.find}
                                    </button>
                                ) : (
                                    <span className="min-w-0 max-w-[40%] truncate text-red line-through decoration-red/60" title={f.find}>{f.find}</span>
                                )}
                                <span aria-hidden="true" className="shrink-0 text-dark-grey">→</span>
                                <input type="text" value={f.replace} disabled={!pending || missing || !f.enabled}
                                    onChange={(e) => updateFix(i, { replace: e.target.value.replace(/[\r\n]/g, " ") })}
                                    aria-label={`Correction for “${f.find}”`}
                                    className="min-w-0 flex-1 rounded-radius-sm border border-border bg-white px-2 py-1 text-success outline-none focus:border-success disabled:opacity-60" />
                                {missing && <span className="shrink-0 text-[12px] text-dark-grey">Not found</span>}
                                {changed && <span className="shrink-0 text-[12px] text-red">Text changed</span>}
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <EditorContent editor={editor} />
            )}

            <div className="ai-suggestion-chrome flex flex-col gap-2 border-t border-border px-3.5 py-2.5 font-sans text-[13px] leading-5">
                {replacing && pending && (
                    <div className="flex items-start gap-1.5 text-dark-grey">
                        <Icon name="info" className="mt-[3px] shrink-0 text-[14px]" />
                        <span>{replacingAll ? "Everything highlighted in red will be replaced." : "The text highlighted in red above will be replaced."}</span>
                    </div>
                )}
                {pending && alsoRemoves && (
                    <div role="alert" className="flex items-start gap-1.5 text-red">
                        <Icon name="warning" className="mt-[3px] shrink-0 text-[14px]" />
                        <span>This also removes {alsoRemoves} (outlined in red). Undo with Ctrl+Z if that's not what you wanted.</span>
                    </div>
                )}
                {pending && problem && (
                    <div role="alert" className="flex items-start gap-1.5 text-red">
                        <Icon name="error" className="mt-[3px] shrink-0 text-[14px]" />{problem}
                    </div>
                )}
                {pending && replacingAll && (
                    <label className="flex cursor-pointer items-center gap-2 text-black">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-red" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                        I understand this replaces my entire draft.
                    </label>
                )}
                {state.error && (state.status === "pending" || state.status === "failed") && (
                    <div role="alert" className="flex items-start gap-1.5 text-red">
                        <Icon name="error" className="mt-[3px] shrink-0 text-[14px]" />{state.error}
                    </div>
                )}

                {pending || state.status === "checking" ? (
                    // Wraps on narrow screens: the hint takes its own line and the buttons never squeeze their labels.
                    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
                        <span className="basis-full text-[12px] text-dark-grey sm:mr-auto sm:basis-auto">{isFixes ? "Untick or edit any fix, then apply." : "Edit the green text, then apply it."}</span>
                        <button type="button" onClick={onCancel} disabled={!pending}
                            className="h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium text-dark-grey transition-colors hover:bg-grey hover:text-black disabled:opacity-50">
                            Cancel
                        </button>
                        <button type="button" onClick={() => onApply(isFixes ? fixes : html, edited.current)} disabled={!canApply}
                            className={`h-8 shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-medium shadow-sm transition-opacity hover:opacity-85 disabled:opacity-40 disabled:shadow-none ${replacingAll ? "bg-red text-[#fff]" : "bg-black text-white"}`}>
                            {state.status === "checking" ? "Applying…" : "Apply Changes"}
                        </button>
                    </div>
                ) : (
                    <div className={`flex items-center gap-1.5 ${state.status === "applied" ? "text-success" : "text-dark-grey"}`}>
                        <Icon name={state.status === "applied" ? "check_circle" : state.status === "failed" ? "error" : "close"} className="shrink-0 text-[14px]" />
                        {state.status === "applied" ? "Applied. Undo with Ctrl+Z." : state.status === "failed" ? "Not applied." : "Cancelled. Your article wasn't changed."}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AiProposalCard;
