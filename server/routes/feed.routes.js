import { Router } from 'express';
import asyncHandler from '../middleware/asyncHandler.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { userFeed, publicationFeed } from '../controllers/feed.controller.js';

const router = Router();

// Public (no auth). RSS 2.0 feeds for feed readers. apiLimiter keeps the
// unauthenticated endpoints from being used for request floods.
router.get('/feed/user/:username.xml', apiLimiter, asyncHandler(userFeed));
router.get('/feed/publication/:slug.xml', apiLimiter, asyncHandler(publicationFeed));

export default router;
