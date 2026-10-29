import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
    generateAccessToken,
    generateRefreshToken,
    generateTokenPair,
    verifyAccessToken,
    verifyRefreshToken,
    hashToken,
    safeEqual,
} from './token.service.js';

describe('token.service', () => {
    const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
    const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;

    beforeAll(() => {
        process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-32-chars-key';
        process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-32-chars-key';
    });

    afterAll(() => {
        process.env.JWT_ACCESS_SECRET = originalAccessSecret;
        process.env.JWT_REFRESH_SECRET = originalRefreshSecret;
    });

    describe('generateAccessToken and verifyAccessToken', () => {
        it('generates a valid access token with userId payload', () => {
            const userId = 'user-12345';
            const token = generateAccessToken(userId);

            expect(typeof token).toBe('string');
            const decoded = verifyAccessToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded.id).toBe(userId);
            expect(decoded.exp).toBeDefined();
            expect(decoded.iat).toBeDefined();
        });

        it('rejects an expired access token', () => {
            // Sign a token that has already expired in the past
            const expiredToken = jwt.sign(
                { id: 'user-expired' },
                process.env.JWT_ACCESS_SECRET,
                { expiresIn: '-10s' }
            );

            const decoded = verifyAccessToken(expiredToken);
            expect(decoded).toBeNull();
        });

        it('rejects a tampered access token', () => {
            const token = generateAccessToken('user-original');
            const parts = token.split('.');
            // Tamper with payload by mutating base64 content
            const tamperedPayload = Buffer.from(
                JSON.stringify({ id: 'user-attacker', iat: Math.floor(Date.now() / 1000) })
            ).toString('base64url');
            const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

            expect(verifyAccessToken(tamperedToken)).toBeNull();
        });

        it('rejects an access token signed with the wrong secret', () => {
            const wrongSecretToken = jwt.sign(
                { id: 'user-wrong-secret' },
                'completely-different-secret-key-123'
            );

            expect(verifyAccessToken(wrongSecretToken)).toBeNull();
        });

        it('rejects a refresh token checked as an access token', () => {
            const refreshToken = generateRefreshToken('user-123', 'session-abc');
            expect(verifyAccessToken(refreshToken)).toBeNull();
        });

        it('rejects malformed strings or null/undefined', () => {
            expect(verifyAccessToken('invalid.token.structure')).toBeNull();
            expect(verifyAccessToken('')).toBeNull();
            expect(verifyAccessToken(null)).toBeNull();
            expect(verifyAccessToken(undefined)).toBeNull();
        });
    });

    describe('generateRefreshToken and verifyRefreshToken', () => {
        it('generates a valid refresh token with userId and sid', () => {
            const userId = 'user-67890';
            const sid = 'session-device-1';
            const token = generateRefreshToken(userId, sid);

            expect(typeof token).toBe('string');
            const decoded = verifyRefreshToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded.id).toBe(userId);
            expect(decoded.sid).toBe(sid);
            expect(decoded.jti).toBeDefined();
        });

        it('generates a valid refresh token without sid when omitted', () => {
            const userId = 'user-legacy';
            const token = generateRefreshToken(userId);

            const decoded = verifyRefreshToken(token);
            expect(decoded).not.toBeNull();
            expect(decoded.id).toBe(userId);
            expect(decoded.sid).toBeUndefined();
            expect(decoded.jti).toBeDefined();
        });

        it('assigns unique jti to every generated refresh token', () => {
            const userId = 'user-unique';
            const sid = 'session-1';
            const token1 = generateRefreshToken(userId, sid);
            const token2 = generateRefreshToken(userId, sid);

            expect(token1).not.toBe(token2);
            const decoded1 = verifyRefreshToken(token1);
            const decoded2 = verifyRefreshToken(token2);
            expect(decoded1.jti).not.toBe(decoded2.jti);
        });

        it('rejects an expired refresh token', () => {
            const expiredToken = jwt.sign(
                { id: 'user-expired', jti: 'test-uuid' },
                process.env.JWT_REFRESH_SECRET,
                { expiresIn: '-10s' }
            );

            expect(verifyRefreshToken(expiredToken)).toBeNull();
        });

        it('rejects a tampered refresh token', () => {
            const token = generateRefreshToken('user-original', 'sid-1');
            const parts = token.split('.');
            // Modify the signature portion
            const modifiedSignature = parts[2].slice(0, -4) + 'abcd';
            const tamperedToken = `${parts[0]}.${parts[1]}.${modifiedSignature}`;

            expect(verifyRefreshToken(tamperedToken)).toBeNull();
        });

        it('rejects a refresh token signed with wrong secret', () => {
            const wrongSecretToken = jwt.sign(
                { id: 'user-wrong', jti: '123' },
                'wrong-refresh-secret'
            );

            expect(verifyRefreshToken(wrongSecretToken)).toBeNull();
        });

        it('rejects an access token checked as a refresh token', () => {
            const accessToken = generateAccessToken('user-123');
            expect(verifyRefreshToken(accessToken)).toBeNull();
        });

        it('rejects malformed strings or null/undefined', () => {
            expect(verifyRefreshToken('not-a-jwt')).toBeNull();
            expect(verifyRefreshToken('')).toBeNull();
            expect(verifyRefreshToken(null)).toBeNull();
            expect(verifyRefreshToken(undefined)).toBeNull();
        });
    });

    describe('generateTokenPair', () => {
        it('returns both valid access and refresh tokens for a user session', () => {
            const userId = 'user-pair-1';
            const sid = 'device-session-pair';

            const pair = generateTokenPair(userId, sid);

            expect(pair).toHaveProperty('access_token');
            expect(pair).toHaveProperty('refresh_token');

            const accessDecoded = verifyAccessToken(pair.access_token);
            expect(accessDecoded).not.toBeNull();
            expect(accessDecoded.id).toBe(userId);

            const refreshDecoded = verifyRefreshToken(pair.refresh_token);
            expect(refreshDecoded).not.toBeNull();
            expect(refreshDecoded.id).toBe(userId);
            expect(refreshDecoded.sid).toBe(sid);
        });
    });

    describe('hashToken', () => {
        it('produces a 64-character hex sha256 hash', () => {
            const token = 'sample-token-to-hash';
            const hash = hashToken(token);

            expect(typeof hash).toBe('string');
            expect(hash.length).toBe(64);
            expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);

            // Should match crypto standard digest
            const expected = crypto.createHash('sha256').update(token).digest('hex');
            expect(hash).toBe(expected);
        });

        it('produces identical hashes for identical inputs and distinct for different inputs', () => {
            const tokenA = 'token-a';
            const tokenB = 'token-b';

            expect(hashToken(tokenA)).toBe(hashToken(tokenA));
            expect(hashToken(tokenA)).not.toBe(hashToken(tokenB));
        });
    });

    describe('safeEqual', () => {
        it('returns true for matching strings', () => {
            const hash1 = hashToken('secret-token');
            const hash2 = hashToken('secret-token');

            expect(safeEqual(hash1, hash2)).toBe(true);
            expect(safeEqual('abc', 'abc')).toBe(true);
        });

        it('returns false for different strings of same length', () => {
            const hash1 = hashToken('token-1');
            const hash2 = hashToken('token-2');

            expect(safeEqual(hash1, hash2)).toBe(false);
            expect(safeEqual('abc', 'abd')).toBe(false);
        });

        it('returns false for strings of different length', () => {
            expect(safeEqual('abc', 'abcd')).toBe(false);
            expect(safeEqual('', 'a')).toBe(false);
        });

        it('returns false for non-string inputs without throwing', () => {
            expect(safeEqual(null, 'abc')).toBe(false);
            expect(safeEqual('abc', null)).toBe(false);
            expect(safeEqual(undefined, undefined)).toBe(false);
            expect(safeEqual(123, 123)).toBe(false);
            expect(safeEqual({}, {})).toBe(false);
        });
    });
});
