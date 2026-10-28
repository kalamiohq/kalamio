import pino from 'pino';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Structured JSON logger using Pino.
 *
 * In production: outputs JSON (for Cloud Logging / log aggregation).
 * In development: outputs pretty-printed human-readable logs.
 *
 * Usage:
 *   import logger from './config/logger.js';
 *   logger.info({ userId: '123' }, 'User logged in');
 *   logger.error({ err }, 'Database query failed');
 */
const logger = pino({
    level: process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug'),

    // Add standard fields to every log line
    base: {
        service: 'kalamio-api',
        env: process.env.NODE_ENV || 'development',
    },

    // Customize timestamp format for Cloud Logging compatibility
    timestamp: pino.stdTimeFunctions.isoTime,

    // Pretty print in development only
    ...(!IS_PRODUCTION && {
        transport: {
            target: 'pino/file',
            options: { destination: 1 }, // stdout
        },
    }),

    // Redact sensitive fields from logs
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'password',
            'newPassword',
            'currentPassword',
            'access_token',
            'refresh_token',
            'otp',
            // AI assistant: provider keys (plain + encrypted) and user content must never reach logs.
            'apiKey',
            '*.apiKey',
            'key_ciphertext',
            '*.key_ciphertext',
            'ai_settings',
            '*.ai_settings',
            'messages',
            '*.messages',
            'article',
            '*.article',
            'req.body',
        ],
        censor: '[REDACTED]',
    },
});

export default logger;
