import { z } from 'zod';
import { PROVIDER_IDS, isSupportedModel } from '../services/ai/providers.js';
import { proposalSchema, toolCallSchema, PROPOSAL_LIMITS } from '../services/ai/editor-tools.js';
import { SUMMARY_MAX_CHARS } from '../services/ai/context.js';

// ── Auth Schemas ────────────────────────────────────────────────────

export const signupSchema = z.object({
    fullname: z.string().min(3, 'Full name must be at least 3 characters').max(50, 'Full name too long'),
    email: z.string().email('Invalid email address').max(100),
    password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

export const signinSchema = z.object({
    email: z.string().min(1, 'Email or username is required').max(100),
    password: z.string().min(1, 'Password is required').max(128),
});

export const verifyEmailSchema = z.object({
    email: z.string().email('Invalid email address'),
    otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const forgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
    email: z.string().email('Invalid email address'),
    otp: z.string().length(6, 'OTP must be 6 digits'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters').max(128),
});

// ── Blog Schemas ────────────────────────────────────────────────────

export const getBlogSchema = z.object({
    blog_id: z.string().min(1, 'Blog ID is required'),
    draft: z.boolean().optional(),
    mode: z.string().optional(),
});

export const likeBlogSchema = z.object({
    _id: z.string().min(1, 'Blog ID is required'),
    isLikedByUser: z.boolean(),
});

export const deleteBlogSchema = z.object({
    blog_id: z.string().min(1, 'Blog ID is required'),
});

// ── Comment Schemas ─────────────────────────────────────────────────

export const addCommentSchema = z.object({
    _id: z.string().min(1, 'Blog ID is required'),
    comment: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
    blog_author: z.string().min(1, 'Blog author is required'),
    replying_to: z.string().optional(),
    notification_id: z.string().optional(),
});

export const deleteCommentSchema = z.object({
    _id: z.string().min(1, 'Comment ID is required'),
});

// ── User Schemas ────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
    username: z.string().min(3, 'Username must be at least 3 characters').max(30),
    bio: z.string().max(150, 'Bio too long').default(''),
    social_links: z.object({
        youtube: z.string().max(200).default(''),
        instagram: z.string().max(200).default(''),
        facebook: z.string().max(200).default(''),
        twitter: z.string().max(200).default(''),
        github: z.string().max(200).default(''),
        website: z.string().max(200).default(''),
    }).optional(),
});

// ── Message Schemas ─────────────────────────────────────────────────

export const sendMessageSchema = z.object({
    content: z.string().min(1, 'Message cannot be empty').max(5000, 'Message too long'),
    recipient_id: z.string().optional(),
    conversation_id: z.string().optional(),
}).refine(data => data.recipient_id || data.conversation_id, {
    message: 'Either recipient_id or conversation_id is required',
});

// ── AI Assistant Schemas ────────────────────────────────────────────

// Request-size caps for /ai/chat. The client trims history and article text to fit; the route's own
// body parser (ai.routes.js) is sized above the worst case these allow. `messages` is the hard cap on
// UN-compacted messages: normally ≤ ~11 reach the server (older ones are folded into the summary), the
// headroom covers a few failed summarizations in a row before the client must start a new chat.
export const AI_LIMITS = {
    messages: 40, messageChars: 8000, toolResultChars: 500, summaryChars: SUMMARY_MAX_CHARS,
    articleTitleChars: 300, articleChars: 60000, outlineHeadings: 200, selectionChars: 8000,
};

const aiProvider = z.enum(PROVIDER_IDS, { message: 'Unsupported AI provider' });
const supportedModel = (data) => data.model === undefined || isSupportedModel(data.provider, data.model);
const unsupportedModel = { message: 'Unsupported model for this provider', path: ['model'] };

export const aiProviderUpdateSchema = z.object({
    provider: aiProvider,
    model: z.string().min(1).max(100),
    // Optional: omitted = keep the saved key and only change the model / make it active.
    apiKey: z.string().trim().min(1, 'Enter your API key').max(300).optional(),
}).refine(supportedModel, unsupportedModel);

export const aiProviderRemoveSchema = z.object({
    provider: aiProvider,
});

const messageId = z.string().min(1).max(100);

// Conversation messages on the wire. Assistant turns may carry ONE article-edit tool call; each tool
// call is answered by a `tool` message with what actually happened in the editor.
const aiMessage = z.discriminatedUnion('role', [
    z.object({
        id: messageId,
        role: z.literal('user'),
        content: z.string().trim().min(1).max(AI_LIMITS.messageChars, 'Message too long'),
    }),
    z.object({
        id: messageId,
        role: z.literal('assistant'),
        content: z.string().trim().max(AI_LIMITS.messageChars, 'Message too long').default(''),
        toolCall: toolCallSchema.optional(),
    }).refine(m => m.content || m.toolCall, 'Assistant messages need text or a tool call'),
    z.object({
        id: messageId,
        role: z.literal('tool'),
        toolCallId: z.string().min(1).max(200),
        operation: z.enum(['insert', 'append', 'replace', 'edit']),
        result: z.object({
            status: z.enum(['applied', 'cancelled', 'failed']),
            message: z.string().trim().max(AI_LIMITS.toolResultChars).optional(),
            edited: z.boolean().optional(),
        }),
    }),
]);

/** Ordering rules a provider would otherwise reject mid-stream (or that would let history lie). */
const checkConversation = (messages, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', message });
    if (!messages.length) return;
    if (new Set(messages.map(m => m.id)).size !== messages.length) issue('Message ids must be unique');
    if (messages[0].role !== 'user') issue('The conversation must start with a user message');
    if (!['user', 'tool'].includes(messages.at(-1).role)) issue('The last message must be from the user or a tool result');
    messages.forEach((m, i) => {
        const next = messages[i + 1];
        if (m.role === 'assistant' && m.toolCall && !(next?.role === 'tool' && next.toolCallId === m.toolCall.id && next.operation === m.toolCall.operation)) {
            issue('Every article-edit proposal must be followed by its result');
        }
        if (m.role === 'tool' && messages[i - 1]?.toolCall?.id !== m.toolCallId) issue('A tool result must directly follow its proposal');
    });
};

// What the browser reports about the article at request time (the editor stays the source of truth).
const aiArticle = z.object({
    title: z.string().max(AI_LIMITS.articleTitleChars).default(''),
    text: z.string().max(AI_LIMITS.articleChars, 'Article too long to send').default(''),
    outline: z.array(z.object({
        text: z.string().trim().max(PROPOSAL_LIMITS.sectionChars),
        level: z.number().int().min(1).max(6),
    })).max(AI_LIMITS.outlineHeadings).default([]),
    // null/absent = no editor cursor; text '' = a caret with nothing selected.
    selection: z.object({ text: z.string().max(AI_LIMITS.selectionChars) }).nullable().default(null),
});

export const aiChatSchema = z.object({
    // Optional override of the saved active provider/model — must be sent together.
    provider: aiProvider.optional(),
    model: z.string().min(1).max(100).optional(),
    // Messages AFTER `context.through` only; older ones are represented by `context.summary`.
    messages: z.array(aiMessage).min(1).max(AI_LIMITS.messages, 'Conversation too long — start a new chat').superRefine(checkConversation),
    context: z.object({
        summary: z.string().trim().max(AI_LIMITS.summaryChars),
        through: messageId,
    }).optional(),
    article: aiArticle.optional(),
})
    .refine(d => (d.provider === undefined) === (d.model === undefined), { message: 'Send provider and model together', path: ['model'] })
    .refine(supportedModel, unsupportedModel);

/** The author's (possibly edited) version of a proposal, checked again right before it's applied. */
export const aiProposalCheckSchema = z.object({
    proposal: proposalSchema,
});

// ── Pagination Schema (reusable) ────────────────────────────────────

export const paginationSchema = z.object({
    page: z.number().int().min(1).default(1),
}).passthrough(); // Allow additional fields
