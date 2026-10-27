import { useEffect, useId, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Icon from "../../Icon";
import { describeTarget } from "../../../common/ai-editor";

const OPERATION_LABEL = { insert: "Insert", append: "Append", replace: "Replace" };

/**
 * Preview of an article change the assistant PROPOSED. Nothing touches the article until the author
 * edits/approves it here and clicks "Apply Changes" (the parent then re-checks it on the server and
 * applies it through TipTap). The model's tool call is never treated as approval.
 *
 * Props:
 *   proposal  — { id, operation, target, content }
 *   state     — { status: 'pending'|'checking'|'applied'|'failed'|'cancelled', error? }
 *   resolved  — resolveTarget() against the live document: where it lands / what it replaces
 *   busy      — another reply is streaming; approval waits
 *   onApply(html, edited) / onCancel()
 */
const AiProposalCard = ({ proposal, state, resolved, busy = false, onApply, onCancel }) => {
    const uid = useId();
    const [html, setHtml] = useState(proposal.content);
    const [empty, setEmpty] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const edited = useRef(false);
    const pending = state.status === "pending";
    const replacingAll = proposal.target.type === "entire_article";

    // A small rich-text editor so the author can edit the proposal before approving it.
    const editor = useEditor({
        extensions: [StarterKit, Underline, Link.configure({ openOnClick: false, autolink: false })],
        content: proposal.content,
        editable: pending,
        editorProps: {
            attributes: {
                class: "tiptap-content prose max-w-none min-h-[72px] max-h-64 overflow-y-auto px-3 py-2 outline-none text-black",
                id: `${uid}-content`,
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

    const blockedReason = empty ? "Add some content, or cancel." : !resolved.ok ? resolved.error : null;
    const canApply = pending && !busy && !empty && resolved.ok && (!replacingAll || confirmed);

    return (
        <section aria-labelledby={`${uid}-title`} className="rounded-radius-md border border-border bg-surface p-3 flex flex-col gap-3">
            <header className="flex items-center gap-2">
                <Icon name="edit_note" className="text-lg text-black" />
                <h3 id={`${uid}-title`} className={`text-base font-semibold ${replacingAll ? "text-red" : "text-black"}`}>
                    {replacingAll ? "Replace entire draft" : `Proposed change: ${OPERATION_LABEL[proposal.operation]}`}
                </h3>
            </header>

            <p className="text-sm text-dark-grey">
                <span className="font-medium text-black">{proposal.operation === "replace" ? "Replaces: " : "Location: "}</span>
                {describeTarget(proposal.target)}
            </p>

            {proposal.operation === "replace" && (
                <div>
                    <p className="text-sm font-medium text-dark-grey mb-1">Current content{replacingAll ? " (all of it will be replaced)" : ""}</p>
                    <div className="max-h-40 overflow-y-auto rounded-radius-sm border border-border bg-white px-3 py-2 text-sm text-dark-grey whitespace-pre-wrap break-words">
                        {resolved.ok ? (resolved.existingText?.trim() || <em>(empty)</em>) : <em>Not available</em>}
                    </div>
                </div>
            )}

            <div>
                <p id={`${uid}-label`} className="text-sm font-medium text-dark-grey mb-1">
                    {proposal.operation === "replace" ? "Replacement" : "Content to add"}{pending ? " — you can edit this before applying" : ""}
                </p>
                <div className={`rounded-radius-sm border bg-white ${empty ? "border-red" : "border-border"}`}>
                    <EditorContent editor={editor} />
                </div>
            </div>

            {pending && blockedReason && (
                <p role="alert" className="flex items-start gap-1.5 text-sm text-red">
                    <Icon name="error" className="text-sm mt-px" />{blockedReason}
                </p>
            )}

            {pending && replacingAll && (
                <label className="flex items-start gap-2 text-sm text-black">
                    <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    I understand this replaces my entire draft.
                </label>
            )}

            {state.error && (state.status === "pending" || state.status === "failed") && (
                <p role="alert" className="flex items-start gap-1.5 text-sm text-red">
                    <Icon name="error" className="text-sm mt-px" />{state.error}
                </p>
            )}

            {pending || state.status === "checking" ? (
                <div className="flex gap-2">
                    <button type="button" onClick={onCancel} disabled={!pending}
                        className="flex-1 rounded-full bg-grey py-2 font-medium text-black hover:bg-border disabled:opacity-50">
                        Cancel
                    </button>
                    <button type="button" onClick={() => onApply(html, edited.current)} disabled={!canApply}
                        className={`flex-1 rounded-full py-2 font-semibold hover:opacity-80 disabled:opacity-40 transition-opacity ${replacingAll ? "bg-red text-[#fff]" : "bg-black text-white"}`}>
                        {state.status === "checking" ? "Applying…" : "Apply Changes"}
                    </button>
                </div>
            ) : (
                <p className={`flex items-center gap-1.5 text-sm ${state.status === "applied" ? "text-success" : "text-dark-grey"}`}>
                    <Icon name={state.status === "applied" ? "check_circle" : state.status === "failed" ? "error" : "close"} className="text-sm" />
                    {state.status === "applied" ? "Applied to your article. Undo with Ctrl+Z." : state.status === "failed" ? "Not applied." : "Cancelled. Your article wasn't changed."}
                </p>
            )}
        </section>
    );
};

export default AiProposalCard;
