import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import mongoose from 'mongoose';
import "dotenv/config";

// Config
import './config/env.js';
import connectDB from './config/db.js';
import { initializePassport } from './config/passport.js';
import { initSocket } from './config/socket.js';

import logger from './config/logger.js';

// Middleware
import errorHandler from './middleware/errorHandler.js';
import requestLogger from './middleware/requestLogger.js';
import originGuard from './middleware/originGuard.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import blogRoutes from './routes/blog.routes.js';
import commentRoutes from './routes/comment.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import userRoutes from './routes/user.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import followRoutes from './routes/follow.routes.js';
import publicationRoutes from './routes/publication.routes.js';
import messageRoutes from './routes/message.routes.js';
import metadataRoutes from './routes/metadata.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import blockRoutes from './routes/block.routes.js';
import collectionRoutes from './routes/collection.routes.js';
import readRoutes from './routes/read.routes.js';
import prerenderRoutes from './routes/prerender.routes.js';
import sitemapRoutes from './routes/sitemap.routes.js';
import aiRoutes from './routes/ai.routes.js';

const server = express();
const httpServer = createServer(server);
const PORT = process.env.PORT || 8080;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Behind Cloudflare → nginx → Cloud Run, so req.ip/req.protocol/req.secure must
// honour X-Forwarded-* (rate limiting keys off CF-Connecting-IP, see rateLimiter).
server.set('trust proxy', true);

// ── Global middleware ──────────────────────────────────────────────
server.use(helmet({
    contentSecurityPolicy: false, // API-only server, CSP is for HTML documents
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow S3 image loading
    crossOriginEmbedderPolicy: false, // Allow embedding cross-origin resources (S3 images)
}));

// Compress API responses (gzip/brotli) — except Server-Sent Events (the AI chat stream). compression
// buffers output until its chunk fills, which would hold back every token instead of streaming it.
server.use(compression({
    filter: (req, res) =>
        !String(res.getHeader('Content-Type') || '').startsWith('text/event-stream') && compression.filter(req, res),
}));

// Structured request logging (JSON with request IDs)
server.use(requestLogger);

// Body parsing. Most endpoints only ever receive small JSON, so we cap them tight (10kb) to blunt
// payload-abuse. A few routes legitimately carry large bodies — a long-form article's content can
// reach a couple of MB — and they parse with their own higher limit inside the router (see
// blog.routes.js `largeBody`). This global parser runs BEFORE the router, so it must skip those
// routes: otherwise the tight limit would 413 a large article before the route's parser is ever
// reached (the bug that made "request entity too large" fire on long posts). Legacy `/api/...` paths
// are covered too, since the `/api → /api/v1` redirect runs after this middleware.
const LARGE_BODY_ROUTES = new Set([
    '/api/v1/create-blog',
    '/api/create-blog',
    '/api/v1/ai/chat', // conversation + article draft as context (see ai.routes.js)
    '/api/v1/ai/proposals/check', // a proposed article change (up to 20k chars)
]);
const defaultJsonParser = express.json({ limit: '10kb' });
server.use((req, res, next) => {
    // Normalize a trailing slash so /api/v1/create-blog/ is treated the same as the canonical path
    // (Express's non-strict router matches both to the same handler).
    const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
    if (LARGE_BODY_ROUTES.has(path)) return next(); // parsed by the route's own larger limit
    return defaultJsonParser(req, res, next);
});

// CORS — restrict origins based on environment
const allowedOrigins = [
    'https://kalamio.com',
    'https://www.kalamio.com',
    'https://dev.kalamio.com',
    process.env.FRONTEND_URL,
    // Only allow localhost in development
    ...(IS_PRODUCTION ? [] : ['http://localhost:5173', 'http://localhost:5174']),
].filter(Boolean);

server.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

// Reject direct-to-origin traffic that bypassed Cloudflare (opt-in via env).
server.use(originGuard);

// Secure caching default: no intermediary (Cloudflare/browser) caches an API
// response unless a handler explicitly opts in with a public Cache-Control
// (see cacheResponse). Prevents accidental edge-caching of per-user data.
server.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// Initialize Passport (Google OAuth)
initializePassport(server);

// Initialize Socket.IO and store reference for controllers
const io = initSocket(httpServer, allowedOrigins);
server.set('io', io);

// ── Health check — Cloud Run uses this to verify container is alive ──
server.get('/health', (req, res) => {
    const dbState = mongoose.connection.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const dbStatus = dbState === 1 ? 'connected' : 'disconnected';
    const isHealthy = dbState === 1;

    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'ok' : 'degraded',
        db: dbStatus,
        uptime: Math.floor(process.uptime()),
    });
});

// ── Mount routes under /api/v1 prefix (versioned API) ───────────────
server.use('/api/v1', authRoutes);
server.use('/api/v1', blogRoutes);
server.use('/api/v1', commentRoutes);
server.use('/api/v1', notificationRoutes);
server.use('/api/v1', userRoutes);
server.use('/api/v1', uploadRoutes);
server.use('/api/v1', followRoutes);
server.use('/api/v1', publicationRoutes);
server.use('/api/v1', messageRoutes);
server.use('/api/v1', metadataRoutes);
server.use('/api/v1', settingsRoutes);
server.use('/api/v1', analyticsRoutes);
server.use('/api/v1', blockRoutes);
server.use('/api/v1', collectionRoutes);
server.use('/api/v1', readRoutes);
server.use('/api/v1', prerenderRoutes);
server.use('/api/v1', sitemapRoutes);
server.use('/api/v1', aiRoutes);

// Backward compat: /api/* → /api/v1/* redirect (remove once all clients updated)
server.use('/api', (req, res, next) => {
    // Only redirect if not already /api/v1
    if (!req.originalUrl.startsWith('/api/v1')) {
        return res.redirect(307, req.originalUrl.replace('/api', '/api/v1'));
    }
    next();
});

// Catch-all 404 for undefined API routes
server.use((req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global error handler (must be after routes)
server.use(errorHandler);

// ── Process-level error handlers ────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️  Unhandled Rejection:', reason);
    // Don't crash — log and continue
});

process.on('uncaughtException', (error) => {
    console.error('🔥 Uncaught Exception:', error);
    // Give time to flush logs, then exit
    setTimeout(() => process.exit(1), 1000);
});

// ── Graceful shutdown ───────────────────────────────────────────────
const gracefulShutdown = (signal) => {
    console.log(`\n🛑 ${signal} received. Starting graceful shutdown...`);

    // Close Socket.IO first — this disconnects all sockets AND closes the underlying HTTP server, so
    // shutdown doesn't stall on long-lived WebSocket connections (which would otherwise keep
    // httpServer.close() from ever completing and skip the Mongo/Redis cleanup below).
    io.close(async () => {
        console.log('✅ Socket.IO + HTTP server closed');

        // Release the Redis adapter's pub/sub connections (no-op in single-instance mode).
        await Promise.allSettled((io.redisClients || []).map(c => c.quit()));

        try {
            // Close MongoDB connection
            await mongoose.connection.close();
            console.log('✅ MongoDB connection closed');
        } catch (err) {
            console.error('❌ Error closing MongoDB:', err.message);
        }

        process.exit(0);
    });

    // Force shutdown after 10 seconds if graceful shutdown stalls
    setTimeout(() => {
        console.error('❌ Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Start server ────────────────────────────────────────────────────
// 1. Start listening IMMEDIATELY so Cloud Run sees port 8080 open
httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, `Server listening on http://0.0.0.0:${PORT}`);

    // 2. Connect to DB AFTER server is already accepting traffic
    connectDB().catch(err => {
        console.error('❌ DB connection error (non-fatal):', err.message);
    });
});

// Request timeout — kill stalled requests after 30 seconds
httpServer.timeout = 30000;