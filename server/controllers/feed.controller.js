import Post from '../Schema/Post.js';
import User from '../Schema/User.js';
import Publication from '../Schema/Publication.js';
import { escapeHtml, isPublicProfile, isPublicPublication, ORIGIN } from './prerender.controller.js';

const DEFAULT_DESCRIPTION = 'Latest articles on Kalamio.';

const toRfc822 = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
};

/**
 * Pure builder — turn a feed's metadata + posts into an RSS 2.0 XML string.
 * Exported so it can be unit-tested without a database.
 */
export const buildFeed = ({ title = '', description = '', link = '', selfUrl = '', posts = [] } = {}) => {
  const safeTitle = title || 'Feed';
  const safeDescription =
    description && String(description).trim() ? description : DEFAULT_DESCRIPTION;
  const lastBuildDate =
    posts.map((post) => toRfc822(post?.publishedAt)).find(Boolean) ||
    toRfc822(new Date());

  const items = posts
    .map((post) => {
      const itemTitle = post?.title || 'Untitled';
      const url = `${ORIGIN}/blog/${encodeURIComponent(post?.blog_id)}`;
      const pubDate = toRfc822(post?.publishedAt);
      const desc = post?.des || '';
      return `    <item>
      <title>${escapeHtml(itemTitle)}</title>
      <link>${escapeHtml(url)}</link>
      <guid isPermaLink="true">${escapeHtml(url)}</guid>${pubDate ? `\n      <pubDate>${pubDate}</pubDate>` : ''}
      <description>${escapeHtml(desc)}</description>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(safeTitle)}</title>
    <link>${escapeHtml(link)}</link>
    <description>${escapeHtml(safeDescription)}</description>
    <language>en</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${escapeHtml(selfUrl)}" rel="self" type="application/rss+xml" />
${items ? `${items}\n` : ''}  </channel>
</rss>`;
};

export const buildUserFeed = ({ user, posts = [] } = {}) => {
  const info = user?.personal_info || {};
  const username = info.username || '';
  const name = info.fullname || username || 'User';
  return buildFeed({
    title: `${name} on Kalamio`,
    description: info.bio || `Articles by ${name} on Kalamio.`,
    link: `${ORIGIN}/user/${encodeURIComponent(username)}`,
    selfUrl: `${ORIGIN}/api/v1/feed/user/${encodeURIComponent(username)}.xml`,
    posts,
  });
};

export const buildPublicationFeed = ({ publication, posts = [] } = {}) => {
  const pub = publication || {};
  const title = pub.title || 'Publication';
  return buildFeed({
    title: `${title} — Kalamio`,
    description: pub.description || `Articles from ${title} on Kalamio.`,
    link: `${ORIGIN}/publication/${encodeURIComponent(pub.slug)}`,
    selfUrl: `${ORIGIN}/api/v1/feed/publication/${encodeURIComponent(pub.slug)}.xml`,
    posts,
  });
};

export const userFeed = async (req, res) => {
  const { username } = req.params;

  const user = await User.findOne({ 'personal_info.username': username })
    .select('personal_info.fullname personal_info.username personal_info.bio account_status.status privacy_settings.show_profile')
    .lean();

  if (!user || !isPublicProfile(user)) {
    return res.status(404).send('Not found');
  }

  const posts = await Post.find({
    author: user._id,
    draft: false,
    type: 'blog',
  })
    .select('blog_id title des publishedAt')
    .sort({ publishedAt: -1 })
    .limit(20)
    .lean();

  const xml = buildUserFeed({ user, posts });
  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=21600');
  return res.status(200).send(xml);
};

export const publicationFeed = async (req, res) => {
  const { slug } = req.params;

  const publication = await Publication.findOne({ slug })
    .select('title slug description visibility')
    .lean();

  if (!publication || !isPublicPublication(publication)) {
    return res.status(404).send('Not found');
  }

  const posts = await Post.find({
    publication: publication._id,
    draft: false,
    type: 'blog',
  })
    .select('blog_id title des publishedAt')
    .sort({ publishedAt: -1 })
    .limit(20)
    .lean();

  const xml = buildPublicationFeed({ publication, posts });
  res.set('Content-Type', 'application/rss+xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=21600');
  return res.status(200).send(xml);
};
