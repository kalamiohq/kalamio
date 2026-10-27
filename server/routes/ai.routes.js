import { Router } from 'express';
import express from 'express';
import { verifyJWT } from '../middleware/auth.js';
import asyncHandler from '../middleware/asyncHandler.js';
import validate from '../middleware/validate.js';
import { aiChatLimiter } from '../middleware/rateLimiter.js';
import { aiChatSchema, aiProviderUpdateSchema, aiProviderRemoveSchema, aiProposalCheckSchema } from '../validators/schemas.js';
import { getAiSettings, updateAiProvider, removeAiProvider, chat, checkProposal } from '../controllers/ai.controller.js';

const router = Router();

// Chat carries the conversation (incl. proposed article changes) + the draft as context, capped by
// AI_LIMITS; a proposal check carries up to 20k chars of content. Both parse with their own limits —
// server.js skips the global 10kb parser for these paths (LARGE_BODY_ROUTES).
const chatBody = express.json({ limit: '1mb' });
const proposalBody = express.json({ limit: '100kb' });

// ── Settings (keys are encrypted server-side; responses never include them) ──
router.post('/ai/settings', verifyJWT, asyncHandler(getAiSettings));
router.post('/ai/settings/update', verifyJWT, validate(aiProviderUpdateSchema), asyncHandler(updateAiProvider));
router.post('/ai/settings/remove', verifyJWT, validate(aiProviderRemoveSchema), asyncHandler(removeAiProvider));

// ── Chat (SSE stream) ── rate limit is per user, so it must come after verifyJWT.
router.post('/ai/chat', verifyJWT, aiChatLimiter, chatBody, validate(aiChatSchema), asyncHandler(chat));

// ── Article changes ── the author's approved (possibly edited) proposal is checked here before the
// browser applies it. Shares the chat limiter: applying a change also triggers a follow-up reply.
router.post('/ai/proposals/check', verifyJWT, aiChatLimiter, proposalBody, validate(aiProposalCheckSchema), asyncHandler(checkProposal));

export default router;
