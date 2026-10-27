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

export const PROPOSAL_LIMITS = { contentChars: 20000, sectionChars: 200 };

export const TARGETS_BY_OPERATION = {
    insert: ['start', 'cursor', 'before_section', 'after_section'],
    append: ['end', 'end_of_section'],
    replace: ['selection', 'section', 'entire_article'],
};
const SECTION_TARGETS = new Set(['before_section', 'after_section', 'end_of_section', 'section']);
const ALL_TARGETS = [...new Set(Object.values(TARGETS_BY_OPERATION).flat())];

export const TOOL_NAME_BY_OPERATION = { insert: 'insertContent', append: 'appendContent', replace: 'replaceContent' };
const OPERATION_BY_TOOL_NAME = Object.fromEntries(Object.entries(TOOL_NAME_BY_OPERATION).map(([op, name]) => [name, op]));

// What TipTap's StarterKit + Underline + Link (the article editor's schema) can represent.
// <h1> is reserved for the article title, so it's downgraded to <h2>.
const ALLOWED_TAGS = ['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'strong', 'em', 'u', 's', 'code', 'pre', 'a', 'br', 'hr'];
export const CONTENT_FORMAT = `HTML using only ${ALLOWED_TAGS.map(t => `<${t}>`).join(', ')} (links as <a href="https://…">)`;

// ── Wire schema: a proposal as sent to the client, echoed back in chat history, and re-checked on apply ──

const proposalObject = z.object({
    operation: z.enum(['insert', 'append', 'replace']),
    target: z.object({
        type: z.enum(ALL_TARGETS),
        section: z.string().trim().min(1).max(PROPOSAL_LIMITS.sectionChars).optional(),
    }),
    content: z.string().trim().min(1, 'The proposed content is empty').max(PROPOSAL_LIMITS.contentChars, 'The proposed content is too long'),
});

const refineProposal = (p, ctx) => {
    if (!TARGETS_BY_OPERATION[p.operation].includes(p.target.type)) {
        ctx.addIssue({ code: 'custom', path: ['target', 'type'], message: `"${p.target.type}" isn't a valid location for ${p.operation}` });
    }
    const needsSection = SECTION_TARGETS.has(p.target.type);
    if (needsSection && !p.target.section) ctx.addIssue({ code: 'custom', path: ['target', 'section'], message: 'A section heading is required for this location' });
    if (!needsSection && p.target.section) ctx.addIssue({ code: 'custom', path: ['target', 'section'], message: 'A section only applies to section locations' });
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
        description: "Propose replacing existing article content: the author's selected text, the body of a named section (its heading is kept), or the entire article. Use ONLY when the author explicitly asks you to rewrite or replace article content. The author previews, can edit, and must approve the change.",
        inputSchema: z.object({
            target: z.enum(TARGETS_BY_OPERATION.replace)
                .describe("selection = the author's currently selected text; section = the body under the named heading; entire_article = the whole draft"),
            section: sectionField,
            content: contentField,
        }),
    }),
};

/** History → model: rebuild the tool input the model originally produced. */
export const proposalToToolInput = ({ operation, target, content }) => ({
    [operation === 'replace' ? 'target' : 'location']: target.type,
    ...(target.section ? { section: target.section } : {}),
    content,
});

// ── Content ──

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Allowlist-sanitize proposal HTML. Plain text (no tags) becomes paragraphs. */
export const sanitizeProposalHtml = (raw) => {
    // Markup = a supported tag, any closing tag, or a tag with attributes. Prose like "use <title> here"
    // stays text; "<script>…</script>" / "<img src=…>" go through the sanitizer (and come out empty).
    const html = /<\/?(p|h[1-6]|ul|ol|li|blockquote|strong|em|b|i|u|s|code|pre|a|br|hr)\b[^>]*>|<\/[a-z][\w-]*\s*>|<[a-z][\w-]*\s+[^>]*=/i.test(raw)
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
        if (!heading) return { ok: false, error: `There's no section titled "${target.section}" in the article.` };
        target = { ...target, section: heading.text }; // normalize to the article's exact heading text
    }
    if (target.type === 'selection' && !article?.selection?.text?.trim()) {
        return { ok: false, error: 'Nothing is selected in the article to replace.' };
    }
    if (target.type === 'cursor' && !article?.selection) {
        return { ok: false, error: "The article editor didn't report a cursor position." };
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
    const type = operation === 'replace' ? input.target : input.location;
    // Models sometimes send an empty/irrelevant `section` on non-section targets — drop it rather than fail.
    const section = SECTION_TARGETS.has(type) ? input.section : undefined;
    return finalizeProposal({ operation, target: { type, ...(section ? { section } : {}) }, content: input.content }, article);
};
