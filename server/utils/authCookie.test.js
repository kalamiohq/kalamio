import { describe, it, expect, vi } from 'vitest';
import {
    REFRESH_COOKIE,
    setRefreshCookie,
    clearRefreshCookie,
    readRefreshToken,
    usesCookieTransport,
    bodyRefreshToken,
} from './authCookie.js';

const mockRes = () => {
    const res = {};
    res.cookie = vi.fn(() => res);
    res.clearCookie = vi.fn(() => res);
    return res;
};

const mockReq = ({ headers = {}, body = null } = {}) => {
    return {
        headers,
        body,
        get: vi.fn((headerName) => {
            const key = Object.keys(headers).find(
                (h) => h.toLowerCase() === headerName.toLowerCase()
            );
            return key ? headers[key] : undefined;
        }),
    };
};

describe('authCookie utils', () => {
    describe('setRefreshCookie', () => {
        it('sets the refresh cookie with appropriate security options and maxAge', () => {
            const res = mockRes();
            const token = 'sample-refresh-token';

            setRefreshCookie(res, token);

            expect(res.cookie).toHaveBeenCalledOnce();
            expect(res.cookie).toHaveBeenCalledWith(
                REFRESH_COOKIE,
                token,
                expect.objectContaining({
                    httpOnly: true,
                    sameSite: 'lax',
                    path: '/api/v1',
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                })
            );
        });
    });

    describe('clearRefreshCookie', () => {
        it('clears the refresh cookie with matching path and flags', () => {
            const res = mockRes();

            clearRefreshCookie(res);

            expect(res.clearCookie).toHaveBeenCalledOnce();
            expect(res.clearCookie).toHaveBeenCalledWith(
                REFRESH_COOKIE,
                expect.objectContaining({
                    httpOnly: true,
                    sameSite: 'lax',
                    path: '/api/v1',
                })
            );
        });
    });

    describe('readRefreshToken', () => {
        it('extracts refresh token from cookies when single cookie is present', () => {
            const req = mockReq({
                headers: { cookie: 'refresh_token=cookie-token-123' },
            });

            expect(readRefreshToken(req)).toBe('cookie-token-123');
        });

        it('extracts refresh token from cookies when multiple cookies are present', () => {
            const req = mockReq({
                headers: { cookie: 'sessionId=abc; refresh_token=cookie-token-456; theme=dark' },
            });

            expect(readRefreshToken(req)).toBe('cookie-token-456');
        });

        it('decodes URL-encoded cookie values', () => {
            const req = mockReq({
                headers: { cookie: 'refresh_token=token%20value%3Dencoded' },
            });

            expect(readRefreshToken(req)).toBe('token value=encoded');
        });

        it('falls back to raw cookie value if URL decoding throws', () => {
            const req = mockReq({
                headers: { cookie: 'refresh_token=%E0%A4%A' },
            });

            expect(readRefreshToken(req)).toBe('%E0%A4%A');
        });

        it('prioritizes cookie over body when both are provided', () => {
            const req = mockReq({
                headers: { cookie: 'refresh_token=cookie-token' },
                body: { refresh_token: 'body-token' },
            });

            expect(readRefreshToken(req)).toBe('cookie-token');
        });

        it('falls back to body.refresh_token when cookie header is not present', () => {
            const req = mockReq({
                headers: {},
                body: { refresh_token: 'body-token-789' },
            });

            expect(readRefreshToken(req)).toBe('body-token-789');
        });

        it('returns null when neither cookie nor body contains refresh_token', () => {
            const req = mockReq({
                headers: { cookie: 'sessionId=abc; theme=dark' },
                body: {},
            });

            expect(readRefreshToken(req)).toBeNull();
        });

        it('returns null when headers and body are missing or empty', () => {
            expect(readRefreshToken({})).toBeNull();
            expect(readRefreshToken({ headers: {} })).toBeNull();
        });

        it('ignores malformed cookie segments lacking an equals sign', () => {
            const req = mockReq({
                headers: { cookie: 'invalidcookiepart; refresh_token=token-val' },
            });

            expect(readRefreshToken(req)).toBe('token-val');
        });
    });

    describe('usesCookieTransport', () => {
        it('returns true when X-Refresh-Transport header is "cookie"', () => {
            const req = mockReq({
                headers: { 'x-refresh-transport': 'cookie' },
            });

            expect(usesCookieTransport(req)).toBe(true);
        });

        it('returns false when X-Refresh-Transport header is missing or different', () => {
            const req1 = mockReq({ headers: {} });
            const req2 = mockReq({ headers: { 'x-refresh-transport': 'bearer' } });

            expect(usesCookieTransport(req1)).toBe(false);
            expect(usesCookieTransport(req2)).toBe(false);
        });
    });

    describe('bodyRefreshToken', () => {
        it('returns undefined when request uses cookie transport', () => {
            const req = mockReq({
                headers: { 'x-refresh-transport': 'cookie' },
            });

            expect(bodyRefreshToken(req, 'token-123')).toBeUndefined();
        });

        it('returns the token when request does not use cookie transport (legacy client)', () => {
            const req = mockReq({
                headers: {},
            });

            expect(bodyRefreshToken(req, 'token-123')).toBe('token-123');
        });
    });
});
