import crypto from 'crypto';

/**
 * AES-256-GCM encryption for users' AI provider API keys at rest.
 *
 * Stored format: "v1.<iv>.<authTag>.<ciphertext>" (base64url parts). The user id is bound in as
 * additional authenticated data, so a ciphertext copied onto another user's document won't decrypt.
 * The 32-byte key comes from AI_KEY_ENCRYPTION_KEY (base64), mounted from Secret Manager in prod.
 *
 * ponytail: single key, no rotation. The "v1" prefix leaves room for a keyring + re-encrypt
 * migration if the key ever has to change.
 */
const VERSION = 'v1';

// Read per call (not at import) so env loading order and tests can't capture a stale value.
const loadKey = () => {
    const raw = process.env.AI_KEY_ENCRYPTION_KEY;
    if (!raw) return null;
    const key = Buffer.from(raw, 'base64');
    return key.length === 32 ? key : null;
};

export const isKeyEncryptionConfigured = () => loadKey() !== null;

export const encryptApiKey = (plaintext, userId) => {
    const key = loadKey();
    if (!key) throw new Error('AI_KEY_ENCRYPTION_KEY is missing or is not 32 bytes of base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(String(userId)));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
};

/** Throws on a wrong key, wrong user, or any tampering (GCM auth tag mismatch). */
export const decryptApiKey = (payload, userId) => {
    const key = loadKey();
    const [version, iv, tag, ciphertext] = String(payload).split('.');
    if (!key || version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Cannot decrypt AI key');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(String(userId)));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
};
