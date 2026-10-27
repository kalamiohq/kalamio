import rateLimit from 'express-rate-limit';
import { getClientIp } from '../utils/helpers.js';

/**
 * Rate limiters for different route categories.
 * Each has different thresholds based on sensitivity.
 */

// Shared config: key by the REAL client IP (CF-Connecting-IP behind Cloudflare),
// not req.ip — otherwise every request looks like it comes from Cloudflare/nginx
// and the whole platform shares one bucket. Since we resolve the IP ourselves,
// disable the library's trust-proxy spoofing check.
const base = {
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req),
    validate: { trustProxy: false },
};

// Strict — login, signup, password reset (brute-force protection)
export const authLimiter = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15,                   // 15 attempts per window
    message: { error: 'Too many auth attempts. Please try again after 15 minutes.' },
});

// Token refresh — looser than authLimiter on purpose. Every signed-in user hits this once per
// ~15 minutes as a matter of course, and shared NAT IPs (offices, campuses) put MANY users behind
// one bucket — the strict login limit would randomly sign people out. Refresh isn't a
// brute-forceable credential either: a guess needs a validly-signed JWT to even reach the DB check.
export const refreshLimiter = rateLimit({
    ...base,
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 120,                  // ~comfortable for a large office behind one IP
    message: { error: 'Too many requests. Please try again shortly.' },
});

// Medium — OTP, email verification (prevent spam)
export const otpLimiter = rateLimit({
    ...base,
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5,                   // 5 OTP requests per window
    message: { error: 'Too many OTP requests. Please try again after 5 minutes.' },
});

// General API — for all other authenticated routes
export const apiLimiter = rateLimit({
    ...base,
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100,                  // 100 requests per minute
    message: { error: 'Too many requests. Please slow down.' },
});

// AI chat — keyed per USER, not IP: each request spends the user's provider credits and our guardrail
// calls, and a shared office IP shouldn't throttle everyone. Mount AFTER verifyJWT (needs req.user).
// ponytail: in-memory per instance like the limiters above; move to a shared store if Cloud Run scales out wide.
export const aiChatLimiter = rateLimit({
    ...base,
    keyGenerator: (req) => `ai-chat:${req.user}`,
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10,                   // 10 AI requests per minute per user
    message: { error: 'Too many AI requests. Please wait a minute and try again.' },
});

// Upload — file upload rate limit
export const uploadLimiter = rateLimit({
    ...base,
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10,                   // 10 uploads per minute
    message: { error: 'Too many uploads. Please try again later.' },
});
