import { tool } from 'ai';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';

/**
 * Article-editing tools for the Kalamio AI assistant.
 *
 * These are deliberately CLIENT-SIDE tools: they have no `execute`, so a model tool call can never
 * change anything by itself. The server validates the call (shape, target against the article
 * outline, sanitized content) and guardrail-checks it, then streams it to the browser as a
 * *proposal*. Only the author's explicit "Apply Changes" — after a second server check of the
 * possibly-edited content (POST /ai/proposals/check) — edits the article, through TipTap.
 */

export const PROPOSAL_LIMITS = { contentChars: 20000, sectionChars: 200, edits: 50, editFindChars: 300, editReplaceChars: 300 };

export const TARGETS_BY_OPERATION = {
    insert: ['start', 'cursor', 'before_section', 'after_section'],
    append: ['end', 'end_of_section'],
    replace: ['selection', 'section', 'entire_article'],
    edit: ['text'], // precise in-place text fixes (spelling, grammar, wording)
};
const SECTION_TARGETS = new Set(['before_section', 'after_section', 'end_of_section', 'section']);
const ALL_TARGETS = [...new Set(Object.values(TARGETS_BY_OPERATION).flat())];

export const TOOL_NAME_BY_OPERATION = { insert: 'insertContent', append: 'appendContent', replace: 'replaceContent', edit: 'editText' };
const OPERATION_BY_TOOL_NAME = Object.fromEntries(Object.entries(TOOL_NAME_BY_OPERATION).map(([op, name]) => [name, op]));

// What TipTap's StarterKit + Underline + Link (the article editor's schema) can represent.
// <h1> is reserved for the article title, so it's downgraded to <h2>.
const ALLOWED_TAGS = ['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 'u', 's', 'code', 'pre', 'a', 'br', 'hr'];
export const CONTENT_FORMAT = `HTML using only ${ALLOWED_TAGS.map(t => `<${t}>`).join(', ')} (links as <a href="https://…">)`;

// ── Wire schema: a proposal as sent to the client, echoed back in chat history, and re-checked on apply ──

const singleLine = (s) => !/[\r\n]/.test(s);
const editItem = z.object({
    find: z.string().min(1).max(PROPOSAL_LIMITS.editFindChars, 'Text to fix is too long').refine(singleLine, 'A fix must stay within one paragraph'),
    replace: z.string().max(PROPOSAL_LIMITS.editReplaceChars, 'Replacement is too long').refine(singleLine, 'A fix must stay within one paragraph'),
});

const proposalObject = z.object({
    operation: z.enum(['insert', 'append', 'replace', 'edit']),
    target: z.object({
        type: z.enum(ALL_TARGETS),
        section: z.string().trim().min(1).max(PROPOSAL_LIMITS.sectionChars).optional(),
    }),
    // insert/append/replace carry HTML `content`; edit carries plain-text `edits`.
    content: z.string().trim().min(1, 'The proposed content is empty').max(PROPOSAL_LIMITS.contentChars, 'The proposed content is too long').optional(),
    edits: z.array(editItem).min(1, 'No fixes were proposed').max(PROPOSAL_LIMITS.edits, 'Too many fixes at once').optional(),
});

const refineProposal = (p, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
    if (!TARGETS_BY_OPERATION[p.operation].includes(p.target.type)) issue(['target', 'type'], `"${p.target.type}" isn't a valid location for ${p.operation}`);
    const needsSection = SECTION_TARGETS.has(p.target.type);
    if (needsSection && !p.target.section) issue(['target', 'section'], 'A section heading is required for this location');
    if (!needsSection && p.target.section) issue(['target', 'section'], 'A section only applies to section locations');
    if (p.operation === 'edit') {
        if (!p.edits) issue(['edits'], 'No fixes were proposed');
        if (p.content !== undefined) issue(['content'], 'Text fixes carry edits, not content');
        p.edits?.forEach((e, i) => { if (e.find === e.replace) issue(['edits', i, 'replace'], 'A fix must change the text'); });
    } else {
        if (p.content === undefined) issue(['content'], 'The proposed content is empty');
        if (p.edits !== undefined) issue(['edits'], 'Only text fixes carry edits');
    }
};

export const proposalSchema = proposalObject.superRefine(refineProposal);
/** Assistant history entry: the proposal plus the provider's tool-call id. */
export const toolCallSchema = proposalObject.extend({ id: z.string().min(1).max(200) }).superRefine(refineProposal);

// ── Tools offered to the model (no `execute` → the step ends with the call) ──

const contentField = z.string().describe(`The exact content to put in the article, as ${CONTENT_FORMAT}.`);
const sectionField = z.string().optional()
    .describe('Exact text of a heading from the article outline. Required for section locations; omit otherwise.');

export const EDITOR_TOOLS = {
    insertContent: tool({
        description: 'Propose inserting new content at a specific place in the article. Use ONLY when the author explicitly asks you to add or insert content into the article. The author previews, can edit, and must approve the change.',
        inputSchema: z.object({
            location: z.enum(TARGETS_BY_OPERATION.insert)
                .describe("start = top of the article; cursor = the author's cursor position; before_section / after_section = directly before / after the named section"),
            section: sectionField,
            content: contentField,
        }),
    }),
    appendContent: tool({
        description: 'Propose appending content to the end of the article or the end of a named section. Use ONLY when the author explicitly asks you to add to the article. The author previews, can edit, and must approve the change.',
        inputSchema: z.object({
            location: z.enum(TARGETS_BY_OPERATION.append).describe('end = end of the article; end_of_section = end of the named section'),
            section: sectionField,
            content: contentField,
        }),
    }),
    replaceContent: tool({
        description: "Propose replacing existing article content: the author's selected text, the body of a named section (its heading is kept), or the entire article. Use ONLY when the author explicitly asks you to rewrite or replace article content — NOT for spelling, grammar or other small local fixes (use editText). The author previews, can edit, and must approve the change.",
        inputSchema: z.object({
            target: z.enum(TARGETS_BY_OPERATION.replace)
                .describe("selection = the author's currently selected text; section = the body under the named heading; entire_article = the whole draft"),
            section: sectionField,
            content: contentField,
        }),
    }),
    editText: tool({
        description: 'Propose precise in-place text fixes — spelling, typos, grammar, punctuation, a word or phrase — leaving everything else untouched (formatting, images and the rest of the text are kept). ALWAYS prefer this over replaceContent for corrections. Each edit replaces the first match of `find` with `replace`. The author reviews each fix and must approve.',
        inputSchema: z.object({
            edits: z.array(z.object({
                find: z.string().describe('Text copied EXACTLY from the article body (same spelling, case and punctuation), within one paragraph. Use whole words plus a word or two of context so it matches the right place, e.g. "too uneliable to".'),
                replace: z.string().describe('The corrected text that replaces `find` (plain text, no HTML). Keep the same surrounding context words.'),
            })).describe('One entry per fix, in reading order.'),
        }),
    }),
};

/** History → model: rebuild the tool input the model originally produced. */
export const proposalToToolInput = ({ operation, target, content, edits }) => (operation === 'edit' ? { edits } : {
    [operation === 'replace' ? 'target' : 'location']: target.type,
    ...(target.section ? { section: target.section } : {}),
    content,
});

/** Readable text of what a proposal would put into the article — for guardrails and summaries. */
export const proposalText = (p) => (p.operation === 'edit' ? p.edits.map(e => e.replace).join('\n') : htmlToText(p.content));

const isWordChar = (c) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
/**
 * Index of the first occurrence of `needle` in `haystack` at or after `from` that doesn't start or end
 * mid-word (so "such s" can't match inside "such some"), or -1. Mirrored in frontend common/ai-editor.js.
 */
export const findWholeText = (haystack, needle, from = 0) => {
    for (let i = haystack.indexOf(needle, from); i !== -1; i = haystack.indexOf(needle, i + 1)) {
        const startsClean = !isWordChar(needle[0]) || !isWordChar(haystack[i - 1]);
        const endsClean = !isWordChar(needle.at(-1)) || !isWordChar(haystack[i + needle.length]);
        if (startsClean && endsClean) return i;
    }
    return -1;
};

// ── Content ──

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Allowlist-sanitize proposal HTML. Plain text (no tags) becomes paragraphs. */
export const sanitizeProposalHtml = (raw) => {
    // Markup = a supported tag, any closing tag, or a tag with attributes. Prose like "use <title> here"
    // stays text; "<script>…</script>" / "<img src=…>" go through the sanitizer (and come out empty).
    // Every repeat stops at the next "<" ([^<>]) and no two quantifiers overlap, so this stays linear on
    // hostile input like "<a" + "\t".repeat(20000) — the old `\s+[^>]*` / `[^>]*` forms were quadratic.
    const html = /<\/?(p|h[1-6]|ul|ol|li|blockquote|strong|em|b|i|u|s|code|pre|a|br|hr)\b[^<>]*>|<\/[a-z][\w-]*\s*>|<[a-z][\w-]*\s[^<>]*=/i.test(raw)
        ? raw
        : raw.trim().split(/\n{2,}/).map(p => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
    return sanitizeHtml(html, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: { a: ['href'] },
        allowedSchemes: ['http', 'https', 'mailto'],
        transformTags: { h1: 'h2', h5: 'h4', h6: 'h4', b: 'strong', i: 'em', strike: 's', del: 's' },
    }).trim();
};

/** Readable text of proposal HTML — what the guardrails and the summarizer look at. */
export const htmlToText = (html) =>
    sanitizeHtml(html.replace(/<\/(p|h\d|li|blockquote|pre)>|<br\s*\/?>/gi, '$&\n'), { allowedTags: [], allowedAttributes: {} })
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const findSection = (outline, name) => {
    const wanted = name.trim().toLowerCase();
    return (outline || []).find(h => h.text.trim().toLowerCase() === wanted);
};

/**
 * Validate a proposal against the article it targets and sanitize its content.
 * `article` is the client-reported state at request time: { outline: [{ text, level }], selection: { text } | null }.
 * The browser re-resolves the target against the live document when the author applies it.
 *
 * @returns {{ ok: true, proposal: object } | { ok: false, error: string }}
 */
export const finalizeProposal = (proposal, article) => {
    const parsed = proposalSchema.safeParse(proposal);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const p = parsed.data;

    let target = p.target;
    if (SECTION_TARGETS.has(target.type)) {
        const heading = findSection(article?.outline, target.section);
        // Don't echo the model-written section name: errors reach the browser as `notice` events, which
        // bypass the output guardrails.
        if (!heading) return { ok: false, error: "The section it named isn't in the article." };
        target = { ...target, section: heading.text }; // normalize to the article's exact heading text
    }
    if (target.type === 'selection' && !article?.selection?.text?.trim()) {
        return { ok: false, error: 'Nothing is selected in the article to replace.' };
    }
    if (target.type === 'cursor' && !article?.selection) {
        return { ok: false, error: "The article editor didn't report a cursor position." };
    }

    if (p.operation === 'edit') {
        // Keep only fixes whose `find` really is in the article (as whole words); the browser locates
        // each one again in the live document when showing them.
        const text = article?.text || '';
        const edits = p.edits.filter(e => findWholeText(text, e.find) !== -1);
        if (!edits.length) return { ok: false, error: "None of the text it wanted to fix was found in the article." };
        return { ok: true, proposal: { operation: 'edit', target, edits } };
    }

    const content = sanitizeProposalHtml(p.content);
    if (!htmlToText(content)) return { ok: false, error: 'The proposed content is empty after removing unsupported formatting.' };
    if (content.length > PROPOSAL_LIMITS.contentChars) return { ok: false, error: 'The proposed content is too long.' };
    return { ok: true, proposal: { operation: p.operation, target, content } };
};

/** A raw model tool call → validated proposal. Unknown tools and malformed input are rejected here. */
export const toolCallToProposal = (toolName, input, article) => {
    const operation = OPERATION_BY_TOOL_NAME[toolName];
    if (!operation || !input || typeof input !== 'object') return { ok: false, error: 'The assistant used an unknown editing tool.' };
    if (operation === 'edit') return finalizeProposal({ operation, target: { type: 'text' }, edits: input.edits }, article);
    const type = operation === 'replace' ? input.target : input.location;
    // Models sometimes send an empty/irrelevant `section` on non-section targets — drop it rather than fail.
    const section = SECTION_TARGETS.has(type) ? input.section : undefined;
    return finalizeProposal({ operation, target: { type, ...(section ? { section } : {}) }, content: input.content }, article);
};
