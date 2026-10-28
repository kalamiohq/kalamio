import OpenAI from 'openai';
import { runGuardrails } from '@openai/guardrails';

/**
 * Input/output safety checks for the AI assistant, built on @openai/guardrails' `runGuardrails`.
 *
 * Checks used (all real registry names from the package):
 *   • "Contains PII" (local regex, always on) in BLOCK mode, limited to high-risk identifiers.
 *     Names, emails, phone numbers, URLs and dates are normal article content, so they're allowed.
 *     Deliberately excluded after probing: US_BANK_NUMBER (flags any 8+ digit number) and the
 *     "Secret Keys" check (flags git hashes / base64 even at `permissive`).
 *     Known ceiling: CREDIT_CARD matches any 16-digit run (no Luhn check).
 *   • "Moderation" (OpenAI moderation API) — only when OPENAI_MODERATION_API_KEY is set, since it
 *     needs an OpenAI client and the server never borrows a user's key for it. Limited to severe
 *     categories: a blogging platform has plenty of legitimate writing about violence, history, etc.
 *
 * Failure policy: FAIL CLOSED. If a check can't run (e.g. the moderation API is down), the request is
 * refused with `reason: 'unavailable'` rather than passing unchecked text.
 */

const HIGH_RISK_PII = ['CREDIT_CARD', 'CVV', 'US_SSN', 'IBAN_CODE', 'UK_NINO', 'IN_AADHAAR', 'IN_PAN'];
const SEVERE_MODERATION_CATEGORIES = [
    'sexual/minors', 'hate/threatening', 'harassment/threatening',
    'self-harm/intent', 'self-harm/instructions', 'illicit/violent',
];

const PII_CHECK = { name: 'Contains PII', config: { entities: HIGH_RISK_PII, block: true, detect_encoded_pii: false } };
const MODERATION_CHECK = { name: 'Moderation', config: { categories: SEVERE_MODERATION_CATEGORIES } };

let moderationClient = null;
let moderationClientKey = null;
const getModerationClient = () => {
    const apiKey = process.env.OPENAI_MODERATION_API_KEY;
    if (!apiKey) return null;
    if (moderationClientKey !== apiKey) {
        moderationClient = new OpenAI({ apiKey, maxRetries: 1, timeout: 10_000 });
        moderationClientKey = apiKey;
    }
    return moderationClient;
};

// Upper bound on one guardrail pass. The moderation client has its own 10s timeout; this also covers
// anything else that stalls, so a hung check refuses (fail closed) instead of hanging the request.
export const GUARDRAIL_TIMEOUT_MS = 15_000;
const TIMED_OUT = Symbol('timeout');

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'pii' | 'moderation' | 'unavailable' | 'timeout' }>}
 */
const runStage = async (stageName, text) => {
    const client = getModerationClient();
    const checks = client ? [PII_CHECK, MODERATION_CHECK] : [PII_CHECK];
    let results;
    let timer;
    try {
        results = await Promise.race([
            runGuardrails(text, { version: 1, stageName, guardrails: checks }, client ? { guardrailLlm: client } : {}, false),
            new Promise(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), GUARDRAIL_TIMEOUT_MS); }),
        ]);
    } catch {
        return { ok: false, reason: 'unavailable' }; // bad bundle / registry error
    } finally {
        clearTimeout(timer);
    }
    if (results === TIMED_OUT) return { ok: false, reason: 'timeout' };
    if (results.some(r => r.executionFailed)) return { ok: false, reason: 'unavailable' };
    // Results come back in bundle order, so the index identifies the check.
    const trippedIndex = results.findIndex(r => r.tripwireTriggered);
    if (trippedIndex === -1) return { ok: true };
    return { ok: false, reason: checks[trippedIndex] === MODERATION_CHECK ? 'moderation' : 'pii' };
};

export const checkInput = (text) => runStage('input', text);
export const checkOutput = (text) => runStage('output', text);

// A whole conversation can be far larger than one moderation request should be, so it's checked in
// slices. Slices overlap so an identifier straddling a boundary is still seen whole in one of them.
export const GUARDRAIL_CHUNK_CHARS = 16_000;
const CHUNK_OVERLAP_CHARS = 64;

/** Input-check text of any length (slices in parallel). Returns the first refusal, else ok. */
export const checkInputText = async (text) => {
    const slices = [];
    for (let start = 0; start < text.length; start += GUARDRAIL_CHUNK_CHARS - CHUNK_OVERLAP_CHARS) {
        slices.push(text.slice(start, start + GUARDRAIL_CHUNK_CHARS));
        if (start + GUARDRAIL_CHUNK_CHARS >= text.length) break;
    }
    const verdicts = await Promise.all(slices.map(checkInput));
    // A content refusal is more useful to report than an infrastructure one.
    return verdicts.find(v => !v.ok && v.reason !== 'unavailable' && v.reason !== 'timeout')
        || verdicts.find(v => !v.ok)
        || { ok: true };
};

/** User-facing copy for each refusal. Never includes the offending text. */
export const GUARDRAIL_MESSAGES = {
    input: {
        pii: 'Your message looks like it contains sensitive personal data (such as a card, ID or bank number). Remove it and try again.',
        moderation: "This request can't be processed because it may violate content guidelines.",
        unavailable: 'Safety checks are temporarily unavailable. Please try again in a moment.',
        timeout: 'Safety checks took too long to respond. Please try again in a moment.',
    },
    output: {
        pii: 'The response was stopped because it contained sensitive personal data.',
        moderation: 'The response was stopped because it may violate content guidelines.',
        unavailable: 'The response was stopped because safety checks are temporarily unavailable. Please try again.',
        timeout: 'The response was stopped because safety checks took too long. Please try again.',
    },
    // The draft itself is sent to the provider as context, so it's screened like a message.
    article: {
        pii: 'Your article contains sensitive personal data (such as a card, ID or bank number). The draft is shared with your AI provider as context, so remove it before using the assistant.',
        moderation: "Your article can't be shared with the AI provider because it may violate content guidelines.",
        unavailable: 'Safety checks are temporarily unavailable. Please try again in a moment.',
        timeout: 'Safety checks took too long to respond. Please try again in a moment.',
    },
    // Article changes (the assistant's proposal, and the author's edited version before it's applied).
    proposal: {
        pii: 'This change contains sensitive personal data (such as a card, ID or bank number), so it can’t be applied.',
        moderation: 'This change may violate content guidelines, so it can’t be applied.',
        unavailable: 'Safety checks are temporarily unavailable, so this change can’t be applied yet. Please try again.',
        timeout: 'Safety checks took too long, so this change can’t be applied yet. Please try again.',
    },
};

/** HTTP status for a refusal: guardrail infrastructure problems are 503, content refusals 422. */
export const guardrailStatus = (reason) => (reason === 'unavailable' || reason === 'timeout' ? 503 : 422);
