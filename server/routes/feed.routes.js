import { Router } from 'express';
import asyncHandler from '../middleware/asyncHandler.js';
import { userFeed, publicationFeed } from '../controllers/feed.controller.js';

const router = Router();

// Public (no auth). RSS 2.0 feeds for feed readers.
router.get('/feed/user/:username.xml', asyncHandler(userFeed));
router.get('/feed/publication/:slug.xml', asyncHandler(publicationFeed));

export default router;
