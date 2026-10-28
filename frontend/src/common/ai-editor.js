import { getAiSuggestion, NON_TEXT_NODES } from '../components/editor/extensions/AiSuggestion';

/**
 * The bridge between AI article-change proposals and the TipTap editor.
 *
 * A proposal is first SHOWN inline (AiSuggestion extension: red = would be removed, green editable
 * preview = would be added) without changing the document. Nothing is applied because the model
 * asked: `applyProposal` only runs after the author clicked "Apply" AND the server re-checked the
 * (possibly edited) content. It applies at the suggestion's live position, which has followed every
 * edit the author made while reviewing.
 */

const SELECTION_CHARS = 8000;   // mirror server AI_LIMITS.selectionChars
const OUTLINE_HEADINGS = 200;   // mirror server AI_LIMITS.outlineHeadings
const SECTION_NAME_CHARS = 200; // mirror server PROPOSAL_LIMITS.sectionChars

export const editorAvailable = (editor) => Boolean(editor && !editor.isDestroyed && editor.state);

// Non-text content appears to the model as "[image]", "[table: …]" etc. instead of vanishing, so it
// knows a section holds more than its words (and the server instructions tell it what they mean).
const markerSerializers = Object.fromEntries(Object.entries(NON_TEXT_NODES)
    .filter(([type]) => type !== 'table') // tables keep their cell text
    .map(([type, label]) => [type, ({ node }) => {
        const detail = node.attrs?.alt || node.attrs?.caption || node.attrs?.fileName || node.attrs?.name || '';
        return `[${label}${detail ? `: ${String(detail).slice(0, 80)}` : ''}]`;
    }]));

/** The article as plain text for the assistant, with markers for images, videos, embeds, files. */
export const articleText = (editor) => editor.getText({ blockSeparator: '\n\n', textSerializers: markerSerializers });

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
 * `range` that "cursor" / "selection" proposals will refer to when shown.
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

const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
/** First whole-word occurrence of `needle` at/after `from`, or -1. Mirrors server findWholeText. */
export const findWholeText = (haystack, needle, from = 0) => {
    for (let i = haystack.indexOf(needle, from); i !== -1; i = haystack.indexOf(needle, i + 1)) {
        const startsClean = !isWordChar(needle[0]) || !isWordChar(haystack[i - 1]);
        const endsClean = !isWordChar(needle.at(-1)) || !isWordChar(haystack[i + needle.length]);
        if (startsClean && endsClean) return i;
    }
    return -1;
};

// Each textblock's text with the document position of every character (inline non-text nodes become
// U+FFFC so a fix can never match across them).
const textblocks = (doc) => {
    const blocks = [];
    doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        let text = '';
        const at = [];
        node.forEach((child, offset) => {
            if (child.isText) {
                for (let k = 0; k < child.text.length; k++) at.push(pos + 1 + offset + k);
                text += child.text;
            } else {
                at.push(pos + 1 + offset);
                text += '￼';
            }
        });
        blocks.push({ text, at });
        return false;
    });
    return blocks;
};

/** Find each fix's `find` (whole words, first unused occurrence) → [{ ...edit, found, from, to }]. */
export const locateEdits = (doc, edits) => {
    const blocks = textblocks(doc);
    const taken = [];
    return edits.map((edit) => {
        for (const block of blocks) {
            for (let i = findWholeText(block.text, edit.find); i !== -1; i = findWholeText(block.text, edit.find, i + 1)) {
                const from = block.at[i];
                const to = block.at[i + edit.find.length - 1] + 1;
                if (!taken.some(t => from < t.to && to > t.from)) {
                    taken.push({ from, to });
                    return { ...edit, found: true, from, to };
                }
            }
        }
        return { ...edit, found: false };
    });
};

export const describeTarget = ({ type, section }) => ({
    text: 'Fixes in place in your article',
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
 * Where a proposal lands in the current document.
 * @returns {{ ok: true, at?: number, from?: number, to?: number, replaceAll?: true } | { ok: false, error: string }}
 */
export const resolveTarget = (editor, { target, edits }, range) => {
    if (!editorAvailable(editor)) return { ok: false, error: "The article editor isn't available right now. Go back to the editor and try again." };
    const { doc } = editor.state;
    if (target.type === 'text') {
        const located = locateEdits(doc, edits || []);
        const first = located.find(e => e.found);
        if (!first) return { ok: false, error: 'The text it wanted to fix is no longer in the article.' };
        // The review card goes right after the top-level block holding the first fix.
        const $first = doc.resolve(first.from);
        return { ok: true, edits: located, at: $first.depth >= 1 ? $first.after(1) : first.to };
    }
    const size = doc.content.size;
    const inSection = (pick) => {
        const { section, error } = findSection(editor, target.section || '');
        return error ? { ok: false, error } : { ok: true, ...pick(section) };
    };

    switch (target.type) {
        case 'start': return { ok: true, at: 0 };
        case 'end': return { ok: true, at: size };
        case 'cursor':
            if (!range || range.from > size) return { ok: false, error: 'Your cursor position is no longer valid. Click where you want the content and ask again.' };
            return { ok: true, at: range.from };
        case 'before_section': return inSection(s => ({ at: s.from }));
        case 'after_section':
        case 'end_of_section': return inSection(s => ({ at: s.to }));
        case 'selection': {
            if (!range || range.from === range.to) return { ok: false, error: 'Nothing was selected when you asked. Select the text and ask again.' };
            const current = range.to <= size ? doc.textBetween(range.from, range.to, '\n\n') : null;
            if (current !== range.text) return { ok: false, error: 'The selected text has changed since you asked. Select it again and ask again.' };
            return { ok: true, from: range.from, to: range.to };
        }
        case 'section': return inSection(s => ({ from: s.bodyFrom, to: s.to }));
        case 'entire_article': return { ok: true, replaceAll: true, from: 0, to: size };
        default: return { ok: false, error: 'Unknown location for this change.' };
    }
};

/** Show a proposal inline (into `dom`) without changing the document. */
export const showSuggestion = (editor, proposal, range, dom) => {
    const target = resolveTarget(editor, proposal, range);
    if (target.ok && target.edits) {
        editor.commands.setAiSuggestion({
            id: proposal.id, dom, at: target.at,
            edits: target.edits.map(e => ({ from: e.from, to: e.to, text: e.replace, found: e.found, enabled: e.found })),
        });
    } else if (target.ok) {
        const { at, from, to, replaceAll } = target;
        editor.commands.setAiSuggestion({ id: proposal.id, dom, ...(at !== undefined ? { at } : { from, to, ...(replaceAll ? { replaceAll } : {}) }) });
    }
    return target;
};

/** Reflect the author's changes to the fix list (edited replacement text, unticked fixes) in the article. */
export const updateSuggestionEdits = (editor, id, fixes) => {
    const s = editorAvailable(editor) ? getAiSuggestion(editor.state) : null;
    if (s?.id !== id || !s.edits) return;
    editor.commands.setAiSuggestion({
        ...s,
        edits: s.edits.map((e, i) => ({ ...e, text: fixes[i]?.replace ?? e.text, enabled: e.found && fixes[i]?.enabled !== false })),
    });
};

/** Remove the inline suggestion — only if it's still this proposal's. */
export const clearSuggestion = (editor, id) => {
    if (editorAvailable(editor) && getAiSuggestion(editor.state)?.id === id) editor.commands.clearAiSuggestion();
};

/** Non-text nodes fully inside [from, to) → { image: 2, table: 1 } */
export const countNonText = (doc, from, to) => {
    const counts = {};
    if (to <= from) return counts;
    doc.nodesBetween(from, to, (node, pos) => {
        const label = NON_TEXT_NODES[node.type.name];
        if (!label) return true;
        if (pos >= from && pos + node.nodeSize <= to) counts[label] = (counts[label] || 0) + 1;
        return false;
    });
    return counts;
};

/** { image: 2, table: 1 } → "2 images and 1 table" */
export const describeCounts = (counts) => {
    const parts = Object.entries(counts).map(([label, n]) => `${n} ${label}${n === 1 ? '' : 's'}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '';
};

/**
 * Apply an APPROVED, server-checked proposal through TipTap (undo/redo, autosave and the editor's
 * schema all apply — content outside the schema is dropped by TipTap's parser). Uses the inline
 * suggestion's live position when it's showing; otherwise resolves the target afresh.
 * @returns {{ ok: boolean, message: string }} the real outcome, reported back to the assistant
 */
export const applyProposal = (editor, proposal, html) => {
    if (!editorAvailable(editor)) return { ok: false, message: "The article editor isn't available right now. Go back to the editor and try again." };
    if (proposal.operation === 'edit') return applyEdits(editor, proposal, html);
    const shown = getAiSuggestion(editor.state);
    let target;
    if (shown?.id === proposal.id) {
        if (shown.stale) return { ok: false, message: 'The text this change was going to replace has been deleted, so it was not applied.' };
        target = shown;
    } else {
        target = resolveTarget(editor, proposal, proposal.range);
        if (!target.ok) return { ok: false, message: target.error };
    }
    try {
        // One transaction: drop the inline preview and make the change (a single undo step).
        let chain = editor.chain();
        if (editor.commands.clearAiSuggestion) chain = chain.clearAiSuggestion();
        chain = target.replaceAll
            ? chain.setContent(html, true)
            : chain.insertContentAt(target.at !== undefined ? target.at : { from: target.from, to: target.to }, html);
        if (!chain.run()) return { ok: false, message: "The editor couldn't apply this change." };
        const verb = proposal.operation === 'replace' ? 'Replaced' : proposal.operation === 'append' ? 'Appended' : 'Inserted';
        return { ok: true, message: `${verb}: ${describeTarget(proposal.target).toLowerCase()}.` };
    } catch {
        return { ok: false, message: "The editor couldn't apply this change." };
    }
};

/**
 * Apply approved text fixes — `fixes` is the author's reviewed list, index-aligned with proposal.edits:
 * [{ replace, enabled }]. Each fix replaces exactly its located range as plain text (never parsed as
 * HTML; the replaced text's formatting is kept). Fixes whose text changed meanwhile are skipped and
 * reported. All in one transaction = one undo step.
 */
const applyEdits = (editor, proposal, fixes) => {
    const shown = getAiSuggestion(editor.state);
    const ranges = shown?.id === proposal.id && shown.edits ? shown.edits : locateEdits(editor.state.doc, proposal.edits);
    const chosen = ranges
        .map((r, i) => ({ ...r, text: fixes?.[i]?.replace ?? r.text ?? r.replace, enabled: fixes?.[i]?.enabled !== false }))
        .filter(r => r.found && r.enabled);
    const usable = chosen.filter(r => !r.stale);
    if (!chosen.length) return { ok: false, message: 'No fixes were selected.' };
    if (!usable.length) return { ok: false, message: 'The text these fixes targeted has changed, so nothing was applied.' };
    try {
        let chain = editor.chain();
        if (editor.commands.clearAiSuggestion) chain = chain.clearAiSuggestion();
        const done = chain.command(({ tr }) => {
            // Back to front, so earlier positions stay valid within the one transaction.
            [...usable].sort((a, b) => b.from - a.from).forEach(r => (r.text ? tr.insertText(r.text, r.from, r.to) : tr.delete(r.from, r.to)));
            return true;
        }).run();
        if (!done) return { ok: false, message: "The editor couldn't apply these fixes." };
        const skipped = chosen.length - usable.length;
        return { ok: true, message: `Applied ${usable.length} text fix${usable.length === 1 ? '' : 'es'}${skipped ? ` (${skipped} skipped because that text changed)` : ''}.` };
    } catch {
        return { ok: false, message: "The editor couldn't apply these fixes." };
    }
};
