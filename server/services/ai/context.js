import { generateText } from 'ai';
import { TOOL_NAME_BY_OPERATION, proposalToToolInput, htmlToText } from './editor-tools.js';

/**
 * Conversation context for the AI assistant — stateless on the server.
 *
 * The browser keeps the full conversation (for the UI) plus `{ summary, through }`, and sends only the
 * messages AFTER `through`. When those exceed ACTIVE_CONTEXT_MESSAGES, the overflow is folded into
 * the existing summary (incremental: previous summary + newly archived messages, never the whole
 * history) and the new `{ summary, through }` is returned to the browser. If summarizing fails, the
 * previous summary and every un-compacted message are kept and sent to the model as-is, so context
 * is never silently dropped; the next request simply tries again.
 */

export const ACTIVE_CONTEXT_MESSAGES = 10;
export const SUMMARY_MAX_CHARS = 6000;
const SUMMARY_TIMEOUT_MS = 30_000;
const TRANSCRIPT_MESSAGE_CHARS = 1500;

/**
 * Split messages into [archived, active]. The active window keeps the newest ~10 messages and always
 * starts on a user message: providers expect that, and it can never separate an assistant tool call
 * from its tool result (a user message never sits between them).
 */
export const planCompaction = (messages, limit = ACTIVE_CONTEXT_MESSAGES) => {
    if (messages.length <= limit) return { archived: [], active: messages };
    const desired = messages.length - limit;
    const userIndexes = messages.flatMap((m, i) => (m.role === 'user' && i > 0 ? [i] : []));
    const boundary = userIndexes.find(i => i >= desired) ?? userIndexes.filter(i => i < desired).at(-1);
    if (!boundary) return { archived: [], active: messages }; // no safe split point
    return { archived: messages.slice(0, boundary), active: messages.slice(boundary) };
};

const clip = (s) => (s.length > TRANSCRIPT_MESSAGE_CHARS ? `${s.slice(0, TRANSCRIPT_MESSAGE_CHARS)} […]` : s);
const describeTarget = ({ type, section }) => (section ? `${type.replace(/_/g, ' ')} "${section}"` : type.replace(/_/g, ' '));

const toTranscriptLine = (m) => {
    if (m.role === 'user') return `Author: ${clip(m.content)}`;
    if (m.role === 'tool') return `Result of the proposed ${m.operation}: ${m.result.status}${m.result.message ? ` (${clip(m.result.message)})` : ''}`;
    const lines = [];
    if (m.content) lines.push(`Assistant: ${clip(m.content)}`);
    if (m.toolCall?.operation === 'edit') {
        lines.push(`Assistant proposed ${m.toolCall.edits.length} text fix(es): ${clip(m.toolCall.edits.map(e => `"${e.find}" → "${e.replace}"`).join('; '))}`);
    } else if (m.toolCall) {
        lines.push(`Assistant proposed to ${m.toolCall.operation} at ${describeTarget(m.toolCall.target)}: ${clip(htmlToText(m.toolCall.content))}`);
    }
    return lines.join('\n');
};

export const SUMMARY_INSTRUCTIONS = [
    'You maintain a running summary of a conversation between an author and Kalamio AI, a writing assistant in an article editor.',
    'Update the existing summary with the new messages. Do not drop anything still relevant from the existing summary.',
    'Preserve: the author\'s instructions and constraints; decisions made; writing and style preferences (tone, audience, length, formatting);',
    'facts about the article (topic, structure, key points); article changes that were proposed, applied, cancelled or failed; open questions and pending tasks.',
    'Drop greetings and redundant detail. Write concise plain-text "-" bullet points, under 300 words. Output only the updated summary.',
].join('\n');

/** Fold newly archived messages into the previous summary with the user's own model. Throws on failure. */
export const summarizeIncrementally = async ({ model, previousSummary, archived, abortSignal }) => {
    const signals = [AbortSignal.timeout(SUMMARY_TIMEOUT_MS), ...(abortSignal ? [abortSignal] : [])];
    const { text } = await generateText({
        model,
        instructions: SUMMARY_INSTRUCTIONS,
        prompt: `<existing_summary>\n${previousSummary || '(none yet)'}\n</existing_summary>\n\n<new_messages>\n${archived.map(toTranscriptLine).join('\n\n')}\n</new_messages>`,
        maxOutputTokens: 800,
        maxRetries: 1,
        abortSignal: AbortSignal.any(signals),
    });
    const summary = text.trim().slice(0, SUMMARY_MAX_CHARS);
    if (!summary) throw new Error('Empty summary');
    return summary;
};

/**
 * Every string of a historical tool call that is replayed to the provider (see proposalToToolInput):
 * section name, each fix's `find` AND `replace`, and the content. proposalText alone isn't enough —
 * it's what would be ADDED to the article, so it skips `find` and the section name.
 */
const toolCallText = (call) => [
    call.target.section,
    ...(call.edits || []).flatMap(e => [e.find, e.replace]),
    call.content ? htmlToText(call.content) : '',
].filter(Boolean).join('\n');

/**
 * All text in a conversation, unclipped — what the input guardrails must screen before ANY provider
 * call (the chat call, and the summarizer, which receives archived messages).
 */
export const conversationText = (messages) => messages.map((m) => {
    if (m.role === 'user') return m.content;
    if (m.role === 'tool') return m.result.message || '';
    return [m.content, m.toolCall ? toolCallText(m.toolCall) : ''].filter(Boolean).join('\n');
}).filter(Boolean).join('\n\n');

/** Every article field that goes to the provider in the instructions (title, outline, selection, body). */
export const articleScreenText = (article) => (article ? [
    article.title,
    ...article.outline.map(h => h.text),
    article.selection?.text,
    article.text,
].filter(Boolean).join('\n\n') : '');

/** Wire messages → AI SDK ModelMessages (tool calls and results as structured parts). */
export const toModelMessages = (messages) => messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.content };
    if (m.role === 'tool') {
        return {
            role: 'tool',
            content: [{ type: 'tool-result', toolCallId: m.toolCallId, toolName: TOOL_NAME_BY_OPERATION[m.operation], output: { type: 'json', value: m.result } }],
        };
    }
    const parts = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    if (m.toolCall) {
        parts.push({ type: 'tool-call', toolCallId: m.toolCall.id, toolName: TOOL_NAME_BY_OPERATION[m.toolCall.operation], input: proposalToToolInput(m.toolCall) });
    }
    return { role: 'assistant', content: parts };
});
