import nodemailer from 'nodemailer';

/**
 * Lazily-initialized SMTP transporter.
 * Default: Gmail with an App Password — NOT the user's actual Gmail password.
 * Generate one at: https://myaccount.google.com/apppasswords
 * If SMTP_HOST is set, uses that server instead (e.g. Mailpit from docker-compose.yml
 * for local dev, which catches every email in a web inbox at http://localhost:8025).
 */
let transporter = null;

const getTransporter = () => {
    if (!transporter) {
        const auth = {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        };
        const port = Number(process.env.SMTP_PORT) || 587;
        transporter = nodemailer.createTransport(process.env.SMTP_HOST
            ? { host: process.env.SMTP_HOST, port, secure: port === 465, auth }
            : { service: 'gmail', auth });
    }
    return transporter;
};

/**
 * Visible sender. With an SMTP relay (e.g. Resend) EMAIL_USER is the relay login, not a
 * mailbox, so EMAIL_FROM sets the address; it falls back to EMAIL_USER for plain Gmail.
 */
const fromAddress = () => `"Kalamio" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`;

/**
 * Sends an OTP email for email verification (signup flow).
 */
export const sendVerificationEmail = async (email, otp) => {
    const mailOptions = {
        from: fromAddress(),
        to: email,
        subject: 'Verify Your Email — Kalamio',
        html: buildOtpEmailHtml({
            heading: 'Verify Your Email',
            message: 'Welcome to Kalamio! Use the code below to verify your email address.',
            otp,
            footer: 'This code expires in 10 minutes. If you didn\'t create an account, ignore this email.',
        }),
    };

    await getTransporter().sendMail(mailOptions);
};

/**
 * Sends an OTP email for password reset flow.
 */
export const sendPasswordResetEmail = async (email, otp) => {
    const mailOptions = {
        from: fromAddress(),
        to: email,
        subject: 'Reset Your Password — Kalamio',
        html: buildOtpEmailHtml({
            heading: 'Reset Your Password',
            message: 'You requested a password reset. Use the code below to set a new password.',
            otp,
            footer: 'This code expires in 10 minutes. If you didn\'t request this, your account is safe — just ignore this email.',
        }),
    };

    await getTransporter().sendMail(mailOptions);
};

// ── Brand ──
// The same look as the Kalamio team's Gmail emails: an ink header band with the "kalamio." wordmark
// and an orange rule, a white body, and a light footer with the k. icon and links. Mail clients drop
// <style> blocks and most layout CSS, so the layout is tables and every style is inline.
const INK = '#121211';
const PAPER = '#FCFCFA';
const ORANGE = '#FD5002';
const MUTED = '#5C5B57';
const PANEL = '#F7F7F4';
const LINE = '#E8E7E2';
const FONT = "'DM Sans','Segoe UI',Helvetica,Arial,sans-serif";

// Small PNGs rendered from the SVG masters in brand/ and served by the web app from
// frontend/public/email/. They always load from production: mail clients fetch images from the open
// internet, and the dev site is behind a password.
const SITE = 'https://kalamio.com';
// brand/logo/kalamio-logo-on-dark.svg on the Ink band colour (not transparent), so the letters stay
// readable if a dark-mode client lightens the band. 256×50 px, shown at 128×25.
const WORDMARK = `${SITE}/email/kalamio-logo-on-dark.png`;
// brand/icon/app-icon.svg, 96×96 px, shown at 32×32.
const ICON = `${SITE}/email/app-icon.png`;

const FOOTER_LINKS = [
    ['kalamio.com', SITE],
    ['GitHub', 'https://github.com/kalamiohq/kalamio'],
    ['Discord', `${SITE}/discord`],
    ['LinkedIn', 'https://www.linkedin.com/company/kalamio'],
];

// Orange dots between the links. The plain space after each dot lets the row wrap on narrow phones.
const FOOTER_LINKS_HTML = FOOTER_LINKS
    .map(([text, href], i) => `<a href="${href}" style="color:${i === 0 ? INK : MUTED};font-weight:${i === 0 ? 600 : 400};text-decoration:none;">${text}</a>`)
    .join(`<span style="color:${ORANGE};">&nbsp;&nbsp;&middot;&nbsp;</span> `);

const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Builds a one-time-code email (signup verification, password reset) in Kalamio's brand: the header
 * band, the heading and message, the code in a panel, the small print, then the brand footer.
 * The code is one unbroken string so it copies cleanly. Text arguments are HTML-escaped.
 */
export function buildOtpEmailHtml({ heading, message, otp, footer }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="border-collapse:collapse;background-color:${PAPER};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <!--[if mso]><table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;border:1px solid ${LINE};border-radius:14px;background-color:#FFFFFF;">
        <tr>
          <td bgcolor="${INK}" style="background-color:${INK};border-radius:13px 13px 0 0;border-bottom:3px solid ${ORANGE};padding:24px 32px 22px;">
            <a href="${SITE}" style="text-decoration:none;"><img src="${WORDMARK}" width="128" height="25" alt="Kalamio" style="display:block;border:0;outline:none;width:128px;height:25px;color:${PAPER};font-family:${FONT};font-size:20px;font-weight:bold;"></a>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 0;font-family:${FONT};font-size:15px;line-height:24px;color:${INK};">
            <h1 style="margin:0 0 12px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:600;color:${INK};">${escapeHtml(heading)}</h1>
            <p style="margin:0;">${escapeHtml(message)}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PANEL}" style="border-collapse:separate;border-spacing:0;background-color:${PANEL};border-left:3px solid ${ORANGE};border-radius:10px;">
              <tr>
                <td style="padding:16px 20px;font-family:${FONT};font-size:32px;line-height:40px;font-weight:700;letter-spacing:6px;color:${INK};"><span style="-webkit-user-select:all;user-select:all;">${escapeHtml(otp)}</span></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px 32px;font-family:${FONT};font-size:13px;line-height:20px;color:${MUTED};">
            <p style="margin:0;">${escapeHtml(footer)}</p>
          </td>
        </tr>
        <tr>
          <td bgcolor="${PANEL}" style="background-color:${PANEL};border-top:1px solid ${LINE};border-radius:0 0 13px 13px;padding:18px 32px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td valign="middle" style="padding:0 12px 0 0;"><a href="${SITE}" style="text-decoration:none;"><img src="${ICON}" width="32" height="32" alt="Kalamio" style="display:block;border:0;outline:none;width:32px;height:32px;"></a></td>
                <td valign="middle" style="font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};"><strong style="color:${INK};font-weight:600;">Kalamio</strong> &middot; Write to the world.<br>${FOOTER_LINKS_HTML}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}
