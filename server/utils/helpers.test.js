import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../Schema/User.js', () => ({
    default: {
        exists: vi.fn(),
    },
}));

import User from '../Schema/User.js';
import { escapeRegex, getClientIp, generateUsername } from './helpers.js';

describe('escapeRegex', () => {
    it('returns empty string for null, undefined, or empty string', () => {
        expect(escapeRegex('')).toBe('');
        expect(escapeRegex(null)).toBe('');
        expect(escapeRegex(undefined)).toBe('');
    });

    it('leaves plain alphanumeric strings unchanged', () => {
        expect(escapeRegex('simpleText123')).toBe('simpleText123');
        expect(escapeRegex('hello world')).toBe('hello world');
    });

    it('escapes all special regex characters', () => {
        const specialChars = '.*+?^${}()|[]\\';
        const escaped = escapeRegex(specialChars);
        expect(escaped).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');

        // Ensures it works as a literal match inside RegExp
        const regex = new RegExp(escaped);
        expect(regex.test(specialChars)).toBe(true);
    });

    it('prevents regex metacharacters from acting as operators', () => {
        const pattern = escapeRegex('foo.bar');
        const regex = new RegExp(`^${pattern}$`);
        expect(regex.test('foo.bar')).toBe(true);
        expect(regex.test('fooxbar')).toBe(false);
    });
});

describe('getClientIp', () => {
    it('prioritizes cf-connecting-ip header over req.ip and socket', () => {
        const req = {
            headers: {
                'cf-connecting-ip': '203.0.113.195',
            },
            ip: '192.168.1.1',
            socket: { remoteAddress: '10.0.0.1' },
        };
        expect(getClientIp(req)).toBe('203.0.113.195');
    });

    it('falls back to req.ip if cf-connecting-ip is not present', () => {
        const req = {
            headers: {},
            ip: '192.168.1.100',
            socket: { remoteAddress: '10.0.0.1' },
        };
        expect(getClientIp(req)).toBe('192.168.1.100');
    });

    it('falls back to req.socket.remoteAddress if req.ip and header are not present', () => {
        const req = {
            headers: {},
            ip: undefined,
            socket: { remoteAddress: '10.0.0.50' },
        };
        expect(getClientIp(req)).toBe('10.0.0.50');
    });

    it('returns "unknown" if no IP information is available', () => {
        const req = {
            headers: {},
            socket: {},
        };
        expect(getClientIp(req)).toBe('unknown');
    });

    it('handles missing socket object gracefully', () => {
        const req = {
            headers: {},
        };
        expect(getClientIp(req)).toBe('unknown');
    });
});

describe('generateUsername', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the base username if it does not already exist in the database', async () => {
        User.exists.mockResolvedValue(null);

        const username = await generateUsername('alex.doe@example.com');

        expect(User.exists).toHaveBeenCalledWith({ 'personal_info.username': 'alex.doe' });
        expect(username).toBe('alex.doe');
    });

    it('appends a 5-character suffix when the username already exists', async () => {
        User.exists.mockResolvedValue({ _id: 'existing-user-id' });

        const username = await generateUsername('john@example.com');

        expect(User.exists).toHaveBeenCalledWith({ 'personal_info.username': 'john' });
        expect(username.startsWith('john')).toBe(true);
        expect(username.length).toBe('john'.length + 5);
        expect(username).not.toBe('john');
    });

    it('handles email addresses with tags or special characters before the @', async () => {
        User.exists.mockResolvedValue(null);

        const username = await generateUsername('user+tag@domain.co');

        expect(User.exists).toHaveBeenCalledWith({ 'personal_info.username': 'user+tag' });
        expect(username).toBe('user+tag');
    });
});
