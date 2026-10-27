// Validate required environment variables at startup
const requiredEnvVars = [
    'DB_LOCATION',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'EMAIL_USER',
    'EMAIL_PASS',
    'AWS_ACCESS_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error(`\n❌ Missing required environment variables:\n`);
    missingVars.forEach(varName => {
        console.error(`   - ${varName}`);
    });
    console.error(`\nPlease add them to your .env file and restart.\n`);
    process.exit(1);
}

// Optional env vars with defaults
const optionalEnvVars = {
    PORT: process.env.PORT || '8080',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
    // Optional — response caching. When both are set, public read endpoints are
    // cached in Upstash Redis; otherwise caching is silently disabled.
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL || '',
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    // Optional — Cloudflare origin lock. When set, only requests carrying this
    // secret in X-Origin-Secret (added by a Cloudflare Transform Rule) are served;
    // direct-to-origin traffic is rejected. Unset = no-op.
    CLOUDFLARE_ORIGIN_SECRET: process.env.CLOUDFLARE_ORIGIN_SECRET || '',
};

// Optional — AI assistant. Deliberately NOT copied into the exported object above: these are secrets.
// AI_KEY_ENCRYPTION_KEY (32 bytes, base64) encrypts users' provider keys at rest; without it the
// /ai endpoints answer 503. OPENAI_MODERATION_API_KEY enables the Moderation guardrail.
if (!process.env.AI_KEY_ENCRYPTION_KEY) {
    console.warn('⚠️  AI_KEY_ENCRYPTION_KEY not set — the AI assistant is disabled');
}

if (!process.env.FRONTEND_URL) {
    console.warn('⚠️  FRONTEND_URL not set — defaulting to http://localhost:5173');
}

export default optionalEnvVars;
