import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';

// Capture each message instead of opening an SMTP connection.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { sendVerificationEmail, sendPasswordResetEmail, buildOtpEmailHtml, buildOtpEmailText } from './email.service.js';

// The images live in the web app, which serves frontend/public/ at https://kalamio.com/.
const PUBLIC_DIR = new URL('../../frontend/public/', import.meta.url);
const FONT = "font-family:'DM Sans','Segoe UI',Helvetica,Arial,sans-serif";

const lastMail = () => sendMail.mock.calls.at(-1)[0];
const imagesIn = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({
    src: tag.match(/\bsrc="([^"]*)"/)?.[1],
    width: Number(tag.match(/\bwidth="(\d+)"/)?.[1]),
    height: Number(tag.match(/\bheight="(\d+)"/)?.[1]),
    alt: tag.match(/\balt="([^"]*)"/)?.[1],
}));

describe('email.service', () => {
    const saved = {};
    const env = { EMAIL_FROM: 'no-reply@kalamio.com', SMTP_HOST: '127.0.0.1', SMTP_PORT: '9' };

    beforeAll(() => {
        for (const [key, value] of Object.entries(env)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
    });

    afterAll(() => {
        for (const key of Object.keys(env)) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    });

    describe('sendVerificationEmail', () => {
        it('sends the signup code from Kalamio with the verification wording', async () => {
            await sendVerificationEmail('reader@example.com', '482917');

            expect(sendMail).toHaveBeenCalledTimes(1);
            const mail = lastMail();
            expect(mail.from).toBe('"Kalamio" <no-reply@kalamio.com>');
            expect(mail.to).toBe('reader@example.com');
            expect(mail.subject).toBe('Verify Your Email — Kalamio');
            expect(mail.html).toContain('>Verify Your Email</h1>');
            expect(mail.html).toContain('Welcome to Kalamio! Use the code below to verify your email address.');
            expect(mail.html).toContain('>482917</span>');
            expect(mail.html).toContain('This code expires in 10 minutes. If you didn&#39;t create an account, ignore this email.');
            expect(mail.text).toBe([
                'Verify Your Email',
                '',
                'Welcome to Kalamio! Use the code below to verify your email address.',
                '',
                '482917',
                '',
                "This code expires in 10 minutes. If you didn't create an account, ignore this email.",
                '',
                '-- ',
                'Kalamio · Write to the world.',
                'https://kalamio.com',
                '',
            ].join('\n'));
        });
    });

    describe('sendPasswordResetEmail', () => {
        it('sends the reset code from Kalamio with the password reset wording', async () => {
            await sendPasswordResetEmail('reader@example.com', '305618');

            expect(sendMail).toHaveBeenCalledTimes(1);
            const mail = lastMail();
            expect(mail.from).toBe('"Kalamio" <no-reply@kalamio.com>');
            expect(mail.to).toBe('reader@example.com');
            expect(mail.subject).toBe('Reset Your Password — Kalamio');
            expect(mail.html).toContain('>Reset Your Password</h1>');
            expect(mail.html).toContain('You requested a password reset. Use the code below to set a new password.');
            expect(mail.html).toContain('>305618</span>');
            expect(mail.html).toContain('This code expires in 10 minutes. If you didn&#39;t request this, your account is safe — just ignore this email.');
            expect(mail.text).toBe([
                'Reset Your Password',
                '',
                'You requested a password reset. Use the code below to set a new password.',
                '',
                '305618',
                '',
                "This code expires in 10 minutes. If you didn't request this, your account is safe — just ignore this email.",
                '',
                '-- ',
                'Kalamio · Write to the world.',
                'https://kalamio.com',
                '',
            ].join('\n'));
        });
    });

    describe('both emails', () => {
        // nodemailer is mocked above. Its real stream transport builds the raw message without sending it.
        it.each([
            ['verification', sendVerificationEmail],
            ['password reset', sendPasswordResetEmail],
        ])('send the %s email as multipart/alternative: the text part, then the HTML part', async (_, send) => {
            await send('reader@example.com', '482917');
            const { default: realNodemailer } = await vi.importActual('nodemailer');
            const { message } = await realNodemailer
                .createTransport({ streamTransport: true, buffer: true })
                .sendMail(lastMail());
            const raw = message.toString();

            expect(raw).toMatch(/^Content-Type: multipart\/alternative;/m);
            const textAt = raw.indexOf('Content-Type: text/plain; charset=utf-8');
            const htmlAt = raw.indexOf('Content-Type: text/html; charset=utf-8');
            expect(textAt).toBeGreaterThan(-1);
            expect(htmlAt).toBeGreaterThan(textAt);
        });
    });

    describe('buildOtpEmailHtml', () => {
        const html = buildOtpEmailHtml({
            heading: 'Verify Your Email',
            message: 'Use the code below.',
            otp: '123456',
            footer: 'This code expires in 10 minutes.',
        });

        it('opens with the brand header: the wordmark on an ink band with an orange rule', () => {
            expect(html).toContain('<td bgcolor="#121211" style="background-color:#121211;');
            expect(html).toContain('border-bottom:3px solid #FD5002;');
            expect(html).toContain('<img src="https://kalamio.com/email/kalamio-logo-on-dark.png" width="128" height="25" alt="Kalamio"');
        });

        it('shows the code large, as one unbroken string so it copies cleanly', () => {
            expect(html).toMatch(/font-size:32px;[^"]*font-weight:700;[^"]*"><span[^>]*>123456<\/span>/);
        });

        it('ends with the brand footer: the k. icon, the tagline and the links', () => {
            expect(html).toContain('<img src="https://kalamio.com/email/app-icon.png" width="32" height="32" alt="Kalamio"');
            expect(html).toContain('Kalamio</strong> &middot; Write to the world.');
            for (const href of [
                'https://kalamio.com',
                'https://github.com/kalamiohq/kalamio',
                'https://kalamio.com/discord',
                'https://www.linkedin.com/company/kalamio',
            ]) {
                expect(html).toContain(`href="${href}"`);
            }
        });

        it('puts the header, heading, code, small print and footer in that order', () => {
            const order = ['kalamio-logo-on-dark.png', 'Verify Your Email</h1>', '123456', 'This code expires', 'Write to the world.']
                .map((text) => html.indexOf(text));
            expect(order.every((at) => at >= 0)).toBe(true);
            expect(order).toEqual([...order].sort((a, b) => a - b));
        });

        it('uses the brand font and colours', () => {
            expect(html).toContain(FONT);
            for (const colour of ['#121211', '#FCFCFA', '#FD5002', '#5C5B57', '#F7F7F4', '#E8E7E2']) {
                expect(html).toContain(colour);
            }
        });

        it('is email-safe: inline styles only, no style blocks, stylesheets, scripts or classes', () => {
            expect(html).not.toMatch(/<style\b/i);
            expect(html).not.toMatch(/<link\b/i);
            expect(html).not.toMatch(/<script\b/i);
            expect(html).not.toMatch(/\sclass="/i);
        });

        it('escapes the text it is given', () => {
            const escaped = buildOtpEmailHtml({
                heading: '<b>Hi</b>',
                message: 'Tom & Jerry',
                otp: '"123456"',
                footer: "It's <i>fine</i>",
            });
            expect(escaped).not.toContain('<b>Hi</b>');
            expect(escaped).toContain('&lt;b&gt;Hi&lt;/b&gt;');
            expect(escaped).toContain('Tom &amp; Jerry');
            expect(escaped).toContain('&quot;123456&quot;');
            expect(escaped).toContain('It&#39;s &lt;i&gt;fine&lt;/i&gt;');
        });

        it('only uses images the web app serves, sharp on high-density screens', () => {
            const images = imagesIn(html);
            expect(images).toHaveLength(2);
            for (const { src, width, height, alt } of images) {
                expect(src).toMatch(/^https:\/\/kalamio\.com\/email\/[\w-]+\.png$/);
                expect(alt).toBe('Kalamio');
                // The PNG's IHDR chunk holds its pixel size; it must be at least 2× the size the email
                // shows it at, with the same aspect ratio.
                const png = readFileSync(new URL(new URL(src).pathname.slice(1), PUBLIC_DIR));
                const scale = png.readUInt32BE(16) / width;
                expect(scale).toBeGreaterThanOrEqual(2);
                expect(png.readUInt32BE(20) / height).toBeCloseTo(scale, 1);
            }
        });
    });

    describe('buildOtpEmailText', () => {
        const text = buildOtpEmailText({
            heading: 'Verify Your Email',
            message: 'Use the code below.',
            otp: '123456',
            footer: 'This code expires in 10 minutes.',
        });
        const lines = text.split('\n');

        it('puts the code alone on its own line, so it copies cleanly', () => {
            expect(lines).toContain('123456');
        });

        it('puts the heading, message, code, small print and footer in that order', () => {
            const order = ['Verify Your Email', 'Use the code below.', '123456', 'This code expires', 'Write to the world.']
                .map((part) => text.indexOf(part));
            expect(order.every((at) => at >= 0)).toBe(true);
            expect(order).toEqual([...order].sort((a, b) => a - b));
        });

        it('ends with the footer after a "-- " signature line', () => {
            expect(lines.slice(-4)).toEqual(['-- ', 'Kalamio · Write to the world.', 'https://kalamio.com', '']);
        });

        it('is plain text: no markup or HTML entities, and the text it is given is kept as is', () => {
            expect(text).not.toMatch(/<[a-z/!]/i);
            const plain = buildOtpEmailText({
                heading: 'Tom & Jerry',
                message: 'Use the code <below>.',
                otp: '"123456"',
                footer: "It's safe — ignore this email.",
            });
            expect(plain.split('\n')).toEqual(expect.arrayContaining([
                'Tom & Jerry',
                'Use the code <below>.',
                '"123456"',
                "It's safe — ignore this email.",
            ]));
            expect(plain).not.toMatch(/&(?:[a-z]+|#\d+|#x[\da-f]+);/i);
        });
    });
});
