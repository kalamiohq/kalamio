/**
 * The bridge between AI article-change proposals and the TipTap editor.
 *
 * Nothing here runs because the model asked: `applyProposal` is only called after the author clicked
 * "Apply Changes" in AiProposalCard AND the server re-checked the (possibly edited) content. Targets are
 * re-resolved against the LIVE document at that moment, so edits the author made in the meantime are
 * respected — a vanished section or a changed selection fails cleanly instead of editing the wrong place.
 */

const SELECTION_CHARS = 8000;   // mirror server AI_LIMITS.selectionChars
const OUTLINE_HEADINGS = 200;   // mirror server AI_LIMITS.outlineHeadings
const SECTION_NAME_CHARS = 200; // mirror server PROPOSAL_LIMITS.sectionChars

export const editorAvailable = (editor) => Boolean(editor && !editor.isDestroyed && editor.state);

/** Top-level headings with their ranges. A section runs until the next heading of the same or higher level. */
export const getSections = (editor) => {
    const { doc } = editor.state;
    const headings = [];
    doc.forEach((node, offset) => {
        if (node.type.name === 'heading') {
            headings.push({ text: node.textContent.trim(), level: node.attrs.level, from: offset, bodyFrom: offset + node.nodeSize });
        }
    });
    return headings.map((h, i) => {
        const next = headings.slice(i + 1).find(n => n.level <= h.level);
        return { ...h, to: next ? next.from : doc.content.size };
    });
};

/**
 * What the assistant is told about the article (outline + selected text), plus the client-only
 * `range` that "cursor" / "selection" proposals will refer to when applied.
 */
export const captureEditorContext = (editor) => {
    if (!editorAvailable(editor)) return { outline: [], selection: null, range: null };
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, '\n\n');
    return {
        outline: getSections(editor).filter(s => s.text).slice(0, OUTLINE_HEADINGS)
            .map(({ text: heading, level }) => ({ text: heading.slice(0, SECTION_NAME_CHARS), level })),
        selection: { text: text.slice(0, SELECTION_CHARS) },
        range: { from, to, text },
    };
};

export const describeTarget = ({ type, section }) => ({
    start: 'At the start of the article',
    cursor: 'At your cursor position',
    before_section: `Before the section “${section}”`,
    after_section: `After the section “${section}”`,
    end: 'At the end of the article',
    end_of_section: `At the end of the section “${section}”`,
    selection: 'Your selected text',
    section: `The body of the section “${section}” (its heading is kept)`,
    entire_article: 'The entire draft',
}[type] || 'Unknown location');

const findSection = (editor, name) => {
    const matches = getSections(editor).filter(s => s.text.toLowerCase() === name.trim().toLowerCase());
    if (!matches.length) return { error: `The section “${name}” is no longer in the article.` };
    if (matches.length > 1) return { error: `Several sections are titled “${name}”. Rename one and ask again.` };
    return { section: matches[0] };
};

/**
 * Where a proposal would land in the current document.
 * @returns {{ ok: true, at?: number, from?: number, to?: number, replaceAll?: true, existingText?: string } | { ok: false, error: string }}
 */
export const resolveTarget = (editor, { target }, range) => {
    if (!editorAvailable(editor)) return { ok: false, error: "The article editor isn't available right now. Go back to the editor and try again." };
    const { doc } = editor.state;
    const size = doc.content.size;
    const inSection = (pick) => {
        const { section, error } = findSection(editor, target.section || '');
        return error ? { ok: false, error } : { ok: true, ...pick(section) };
    };

    switch (target.type) {
        case 'start': return { ok: true, at: 0 };
        case 'end': return { ok: true, at: size };
        case 'cursor':
            // ponytail: positions aren't mapped through later edits; an out-of-range cursor fails instead.
            if (!range || range.from > size) return { ok: false, error: 'Your cursor position is no longer valid. Click where you want the content and ask again.' };
            return { ok: true, at: range.from };
        case 'before_section': return inSection(s => ({ at: s.from }));
        case 'after_section':
        case 'end_of_section': return inSection(s => ({ at: s.to }));
        case 'selection': {
            if (!range || range.from === range.to) return { ok: false, error: 'Nothing was selected when you asked. Select the text and ask again.' };
            const current = range.to <= size ? doc.textBetween(range.from, range.to, '\n\n') : null;
            if (current !== range.text) return { ok: false, error: 'The selected text has changed since you asked. Select it again and ask again.' };
            return { ok: true, from: range.from, to: range.to, existingText: current };
        }
        case 'section': return inSection(s => ({ from: s.bodyFrom, to: s.to, existingText: doc.textBetween(s.bodyFrom, s.to, '\n\n') }));
        case 'entire_article': return { ok: true, replaceAll: true, existingText: editor.getText() };
        default: return { ok: false, error: 'Unknown location for this change.' };
    }
};

/**
 * Apply an APPROVED, server-checked proposal through TipTap commands (so undo/redo, autosave and the
 * editor's schema all apply — content outside the schema is dropped by TipTap's parser).
 * @returns {{ ok: boolean, message: string }} the real outcome, reported back to the assistant
 */
export const applyProposal = (editor, proposal, range, html) => {
    const target = resolveTarget(editor, proposal, range);
    if (!target.ok) return { ok: false, message: target.error };
    try {
        let done;
        if (target.replaceAll) done = editor.commands.setContent(html, true);
        else if (target.at !== undefined) done = editor.commands.insertContentAt(target.at, html);
        else done = editor.commands.insertContentAt({ from: target.from, to: target.to }, html);
        if (!done) return { ok: false, message: "The editor couldn't apply this change." };
        return { ok: true, message: `${proposal.operation === 'replace' ? 'Replaced' : proposal.operation === 'append' ? 'Appended' : 'Inserted'}: ${describeTarget(proposal.target).toLowerCase()}.` };
    } catch {
        return { ok: false, message: "The editor couldn't apply this change." };
    }
};
