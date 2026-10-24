import Post from '../Schema/Post.js';
import User from '../Schema/User.js';
import Publication from '../Schema/Publication.js';
import { cdnUrl } from '../config/cdn.js';

/**
 * Server-side prerender for social-unfurl crawlers.
 *
 * The SPA sets Open Graph tags at runtime, but crawlers like facebookexternalhit
 * / Twitterbot / LinkedInBot / Slackbot don't run JS, so they only ever see the
 * static index.html defaults. nginx routes those bots (by User-Agent) to this
 * endpoint, which fetches the entity and returns a minimal HTML document with the
 * correct per-page OG/Twitter tags + JSON-LD — everything an unfurl needs.
 */

const SITE_NAME = 'Kalamio';
export const ORIGIN = (process.env.FRONTEND_URL || 'https://kalamio.com').replace(/\/+$/, '');
const DEFAULT_DESCRIPTION =
  'Kalamio is the publishing platform for every voice on earth. Write your ideas, publish your story, reach readers who care.';
const DEFAULT_IMAGE = `${ORIGIN}/og-image.png`;
const LOGO_IMAGE = `${ORIGIN}/logo-512.png`;

export const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const truncate = (value = '', max = 200) => {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/**
 * Render a minimal, self-contained HTML document carrying the given meta.
 * Only the <head> matters to unfurl bots; the <body> is a courtesy fallback.
 */
export const renderMetaHtml = (meta) => {
  const title = meta.title || SITE_NAME;
  const description = truncate(meta.description || DEFAULT_DESCRIPTION, 300);
  const image = meta.image || DEFAULT_IMAGE;
  const url = meta.url || ORIGIN;
  const type = meta.type || 'website';

  const fullTitle = title === SITE_NAME ? SITE_NAME : `${title} — ${SITE_NAME}`;
  const t = escapeHtml(fullTitle);
  const rawTitle = escapeHtml(title);
  const d = escapeHtml(description);
  const img = escapeHtml(image);
  const u = escapeHtml(url);
  // </script> inside JSON must be neutralised so it can't break out of the tag.
  const jsonLd = meta.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="robots" content="index, follow" />
<title>${t}</title>
<meta name="description" content="${d}" />
<link rel="canonical" href="${u}" />
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
<meta property="og:type" content="${escapeHtml(type)}" />
<meta property="og:title" content="${rawTitle}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${u}" />
<meta property="og:image" content="${img}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${rawTitle}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${img}" />
${jsonLd}
</head>
<body>
<h1>${rawTitle}</h1>
<p>${d}</p>
<p><a href="${u}">View on ${escapeHtml(SITE_NAME)}</a></p>
</body>
</html>`;
};

// ── Per-type meta builders (pure — take a plain entity, return a meta object) ──

export const blogMeta = (blog) => {
  const url = `${ORIGIN}/blog/${blog.blog_id}`;
  const isTextPost = blog.type === 'text_post';
  const title = isTextPost
    ? (blog.text_content ? truncate(blog.text_content, 60) : 'Text Post')
    : (blog.title || 'Blog');
  const description =
    blog.des || (blog.text_content ? truncate(blog.text_content, 200) : DEFAULT_DESCRIPTION);
  const image = cdnUrl(blog.banner) || DEFAULT_IMAGE;
  const authorName = blog.author?.personal_info?.fullname;
  const authorUsername = blog.author?.personal_info?.username;

  return {
    title,
    description,
    image,
    url,
    type: 'article',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: title,
      description: truncate(description, 200),
      image,
      datePublished: blog.publishedAt || undefined,
      mainEntityOfPage: url,
      author: {
        '@type': 'Person',
        name: authorName,
        url: authorUsername ? `${ORIGIN}/user/${authorUsername}` : undefined,
      },
      publisher: {
        '@type': 'Organization',
        name: SITE_NAME,
        logo: { '@type': 'ImageObject', url: LOGO_IMAGE },
      },
    },
  };
};

export const userMeta = (user) => {
  const p = user.personal_info || {};
  return {
    title: p.fullname || `@${p.username}`,
    description: (p.bio && p.bio.trim()) || `@${p.username} on ${SITE_NAME}`,
    image: cdnUrl(p.profile_img) || DEFAULT_IMAGE,
    url: `${ORIGIN}/user/${p.username}`,
    type: 'profile',
  };
};

export const publicationMeta = (pub) => ({
  title: pub.title || 'Publication',
  description: (pub.description && pub.description.trim()) || `${pub.title} on ${SITE_NAME}`,
  image: cdnUrl(pub.profile_photo || pub.banner) || DEFAULT_IMAGE,
  url: `${ORIGIN}/publication/${pub.slug}`,
  type: 'website',
});

/**
 * Resolve the requested SPA path (e.g. "blog/abc") to a meta object, or null.
 * Exported so it can be unit-tested with mocked models.
 */
export const resolveMeta = async (rawPath) => {
  const [type, ...rest] = String(rawPath || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean);
  const id = rest.join('/');
  if (!type || !id) return null;

  if (type === 'blog') {
    const blog = await Post.findOne({ blog_id: id, draft: false })
      .populate('author', 'personal_info.fullname personal_info.username')
      .select('title des banner blog_id publishedAt tags author type text_content')
      .lean();
    return blog ? blogMeta(blog) : null;
  }
  if (type === 'user') {
    const user = await User.findOne({ 'personal_info.username': id })
      .select('personal_info.fullname personal_info.username personal_info.bio personal_info.profile_img')
      .lean();
    return user ? userMeta(user) : null;
  }
  if (type === 'publication') {
    const pub = await Publication.findOne({ slug: id })
      .select('title slug description banner profile_photo')
      .lean();
    return pub ? publicationMeta(pub) : null;
  }
  return null;
};

/**
 * Express handler. Mounted so that nginx-proxied bot requests reach it as
 * GET /api/v1/prerender/<original-path>. Always returns 200 HTML (falling back
 * to site defaults) so a crawler never gets an error card.
 */
export const prerender = async (req, res) => {
  const rawPath = req.params[0] || '';
  let meta = null;
  try {
    meta = await resolveMeta(rawPath);
  } catch {
    meta = null; // fall back to defaults — never fail an unfurl
  }
  if (!meta) {
    meta = { url: `${ORIGIN}/${rawPath.split('?')[0]}` };
  }

  res.set('Content-Type', 'text/html; charset=utf-8');
  // Let crawlers/CDN cache briefly so a viral link doesn't hammer the DB.
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.set('X-Prerender', 'kalamio');
  return res.status(200).send(renderMetaHtml(meta));
};
