import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';

/**
 * AI provider catalog — the single source of truth for which providers/models the assistant
 * supports. The frontend renders this list from GET-style `POST /ai/settings`, so adding a model
 * here is the whole change.
 *
 * ponytail: hand-picked model list; IDs come from each @ai-sdk/* package's model-id types —
 * update when providers ship new models.
 */
export const AI_PROVIDERS = {
    gemini: {
        name: 'Gemini',
        createProvider: createGoogle,
        keyPrefix: 'AIza',
        keyPattern: /^AIza[0-9A-Za-z_-]{35}$/,
        keysUrl: 'https://aistudio.google.com/app/apikey',
        models: [
            { id: 'gemini-pro-latest', name: 'Gemini Pro (latest)' },
            { id: 'gemini-flash-latest', name: 'Gemini Flash (latest)' },
            { id: 'gemini-flash-lite-latest', name: 'Gemini Flash-Lite (latest)' },
        ],
    },
    openai: {
        name: 'OpenAI',
        createProvider: createOpenAI,
        keyPrefix: 'sk-',
        // `sk-ant-` is Anthropic's prefix; excluded so a Claude key is never accepted as OpenAI.
        keyPattern: /^sk-(?!ant-)[A-Za-z0-9_-]{20,}$/,
        keysUrl: 'https://platform.openai.com/api-keys',
        models: [
            { id: 'gpt-5.6', name: 'GPT-5.6' },
            { id: 'gpt-5.5', name: 'GPT-5.5' },
            { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini' },
        ],
    },
    grok: {
        name: 'Grok',
        createProvider: createXai,
        keyPrefix: 'xai-',
        keyPattern: /^xai-[A-Za-z0-9_-]{20,}$/,
        keysUrl: 'https://console.x.ai',
        models: [
            { id: 'grok-4.7', name: 'Grok 4.7' },
            { id: 'grok-4.6', name: 'Grok 4.6' },
            { id: 'grok-latest', name: 'Grok (latest)' },
        ],
    },
    claude: {
        name: 'Claude',
        createProvider: createAnthropic,
        keyPrefix: 'sk-ant-',
        keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
        keysUrl: 'https://console.anthropic.com/settings/keys',
        models: [
            { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
            { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
            { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
        ],
    },
};

export const PROVIDER_IDS = Object.keys(AI_PROVIDERS);

/** What the client is allowed to see — no patterns or factories. */
export const publicCatalog = () =>
    Object.entries(AI_PROVIDERS).map(([id, p]) => ({ id, name: p.name, keyPrefix: p.keyPrefix, keysUrl: p.keysUrl, models: p.models }));

export const isSupportedModel = (providerId, modelId) =>
    Boolean(AI_PROVIDERS[providerId]?.models.some(m => m.id === modelId));

/** Returns a user-facing error for a malformed key, or '' when the format looks right. Never echoes the key. */
export const validateApiKeyFormat = (providerId, key) => {
    const provider = AI_PROVIDERS[providerId];
    if (!provider) return 'Unsupported AI provider.';
    if (provider.keyPattern.test(key)) return '';
    // Pasted a key from a different provider? Say which, instead of a generic error.
    const other = Object.values(AI_PROVIDERS).find(p => p !== provider && p.keyPattern.test(key));
    if (other) return `This looks like a ${other.name} key. Switch the provider to ${other.name}, or paste your ${provider.name} key.`;
    return `That doesn't look like a ${provider.name} key — they start with "${provider.keyPrefix}".`;
};

/**
 * Build an AI SDK language model bound to the user's own key.
 * The key is ALWAYS passed explicitly: the @ai-sdk factories otherwise fall back to env vars
 * (OPENAI_API_KEY, …), which would silently bill a server credential for a user's request.
 */
export const createLanguageModel = (providerId, modelId, apiKey) => {
    if (!apiKey) throw new Error('Missing user API key');
    if (!isSupportedModel(providerId, modelId)) throw new Error('Unsupported provider/model');
    return AI_PROVIDERS[providerId].createProvider({ apiKey })(modelId);
};
