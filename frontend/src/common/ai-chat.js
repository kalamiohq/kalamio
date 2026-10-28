import api, { ensureFreshToken } from './api';

/**
 * Stream a Kalamio AI reply from `POST /ai/chat` (Server-Sent Events).
 *
 * Uses fetch rather than the axios `api` instance because axios (XHR) can't hand over a response body
 * progressively. Auth mirrors the interceptor: a fresh access token from the shared refresh logic.
 *
 * Server events (see server/controllers/ai.controller.js): `delta {text}` · `status {message}` ·
 * `context {summary, through}|{status}` · `proposal {toolCallId, operation, target, content}` ·
 * `notice {message}` · `done` · `blocked {message}` · `error {message}`. Lines starting with ":"
 * are keep-alive comments.
 *
 * A `proposal` is only a suggestion to show the author — it is never applied from here.
 *
 * @param {{ body: { messages: object[], context?: object, article?: object, provider?: string, model?: string },
 *           signal?: AbortSignal, onDelta: (text: string) => void, onStatus?: (message: string) => void,
 *           onContext?: (context: object) => void, onProposal?: (proposal: object) => void,
 *           onNotice?: (message: string) => void }} options
 * @returns {Promise<{ status: 'done' } | { status: 'blocked'|'error', message: string } | { status: 'aborted' }>}
 */
export const streamAiChat = async ({ body, signal, onDelta, onStatus, onContext, onProposal, onNotice }) => {
  const token = await ensureFreshToken();
  if (!token) return { status: 'error', message: 'Please sign in again to use the AI assistant.' };

  let res;
  try {
    res = await fetch(`${api.defaults.baseURL}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    if (signal?.aborted) return { status: 'aborted' };
    return { status: 'error', message: "Couldn't reach Kalamio. Check your connection and try again." };
  }

  // Failures before streaming starts (validation, input guardrail, rate limit, setup) are plain JSON.
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return {
      status: res.status === 422 ? 'blocked' : 'error',
      message: data.details?.[0]?.message || data.error || 'Something went wrong. Please try again.',
    };
  }

  const handlers = {
    delta: (d) => onDelta(d.text),
    status: (d) => onStatus?.(d.message),
    context: (d) => onContext?.(d),
    proposal: (d) => onProposal?.(d),
    notice: (d) => onNotice?.(d.message),
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = parseEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (!event) continue;
        if (event.type === 'done') return { status: 'done' };
        if (event.type === 'blocked' || event.type === 'error') return { status: event.type, message: event.data.message };
        handlers[event.type]?.(event.data);
      }
    }
  } catch {
    if (signal?.aborted) return { status: 'aborted' };
    return { status: 'error', message: 'The connection was interrupted. Please try again.' };
  }
  return signal?.aborted
    ? { status: 'aborted' }
    : { status: 'error', message: 'The response ended unexpectedly. Please try again.' };
};

const parseEvent = (block) => {
  let type = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null; // keep-alive comment
  try { return { type, data: JSON.parse(data) }; } catch { return null; }
};

/**
 * Server check of the author's (possibly edited) proposal right before it's applied.
 * @returns {Promise<{ ok: true, content: string } | { ok: false, message: string }>} `content` is the
 *   sanitized HTML that may be applied — exactly what was checked.
 */
export const checkProposal = async ({ operation, target, content, edits }) => {
  try {
    const { data } = await api.post("/ai/proposals/check", { proposal: { operation, target, ...(edits ? { edits } : { content }) } });
    return { ok: true, content: data.proposal.content };
  } catch (err) {
    const data = err?.response?.data;
    return { ok: false, message: data?.details?.[0]?.message || data?.error || "Couldn't check this change. Please try again." };
  }
};
