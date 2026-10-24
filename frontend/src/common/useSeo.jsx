import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Dependency-free SEO / social-meta manager.
 *
 * Imperatively keeps the document <title>, description, canonical link, Open
 * Graph + Twitter Card tags, the robots directive, and optional JSON-LD in sync
 * with the current route. Tags declared statically in index.html are UPSERTED
 * (updated in place), so there are never duplicates.
 *
 * NOTE: social-unfurl crawlers (Facebook/LinkedIn/Slack) generally don't run JS,
 * so they see index.html's static defaults, not these client-set values. Google
 * (which renders JS) and browser tabs get the per-route values here. Per-post
 * social cards need server-side prerendering — see the SEO follow-up.
 *
 * @param {object} opts
 * @param {string} [opts.title]        Page title (site name is appended).
 * @param {string} [opts.description]  Meta/OG/Twitter description.
 * @param {string} [opts.image]        Absolute OG/Twitter image URL.
 * @param {string} [opts.url]          Canonical/OG URL (defaults to prod origin + path).
 * @param {"website"|"article"|"profile"} [opts.type]  og:type.
 * @param {boolean} [opts.noindex]     Emit robots noindex,nofollow.
 * @param {object|null} [opts.jsonLd]  Structured-data object injected as ld+json.
 */
export const SITE_NAME = "Kalamio";
export const PRODUCTION_ORIGIN = "https://kalamio.com";
export const DEFAULT_DESCRIPTION =
  "Kalamio is the publishing platform for every voice on earth. Write your ideas, publish your story, reach readers who care.";
export const DEFAULT_IMAGE = `${PRODUCTION_ORIGIN}/og-image.png`;
export const LOGO_IMAGE = `${PRODUCTION_ORIGIN}/logo-512.png`;

const JSONLD_ID = "seo-jsonld";

const upsertMeta = (attr, key, content) => {
  if (content == null || content === "") return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const upsertCanonical = (href) => {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

const setJsonLd = (data) => {
  let el = document.getElementById(JSONLD_ID);
  if (data) {
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = JSONLD_ID;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  } else if (el) {
    el.remove();
  }
};

const isNonPublicHost = () => {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h.startsWith("127.") || h.startsWith("dev.");
};

export const useSeo = ({
  title,
  description,
  image,
  url,
  type = "website",
  noindex = false,
  jsonLd = null,
} = {}) => {
  const { pathname } = useLocation();
  // Stable dependency for the (rarely-changing) structured data object.
  const jsonLdKey = jsonLd ? JSON.stringify(jsonLd) : null;

  useEffect(() => {
    const desc = description || DEFAULT_DESCRIPTION;
    const canonicalUrl = url || PRODUCTION_ORIGIN + pathname;
    const img = image || DEFAULT_IMAGE;
    const ogTitle = title || SITE_NAME;

    document.title =
      title && title !== SITE_NAME ? `${title} — ${SITE_NAME}` : SITE_NAME;

    upsertMeta("name", "description", desc);
    upsertCanonical(canonicalUrl);

    // Open Graph
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:title", ogTitle);
    upsertMeta("property", "og:description", desc);
    upsertMeta("property", "og:url", canonicalUrl);
    upsertMeta("property", "og:image", img);

    // Twitter Card
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", ogTitle);
    upsertMeta("name", "twitter:description", desc);
    upsertMeta("name", "twitter:image", img);

    // Robots — explicit on every page so navigating away from a noindex page
    // correctly restores indexability (and dev/local hosts stay noindex).
    upsertMeta(
      "name",
      "robots",
      noindex || isNonPublicHost() ? "noindex, nofollow" : "index, follow",
    );

    setJsonLd(jsonLd);

    return () => {
      document.title = SITE_NAME;
      // Structured data is page-specific — don't let it leak to the next route.
      setJsonLd(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, image, url, type, noindex, pathname, jsonLdKey]);
};

/**
 * Build a schema.org BlogPosting object for a blog/article page.
 */
export const buildArticleJsonLd = ({
  title,
  description,
  image,
  url,
  publishedAt,
  authorName,
  authorUsername,
}) => ({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: title,
  description: description || DEFAULT_DESCRIPTION,
  image: image || DEFAULT_IMAGE,
  datePublished: publishedAt || undefined,
  mainEntityOfPage: url,
  author: {
    "@type": "Person",
    name: authorName,
    url: authorUsername ? `${PRODUCTION_ORIGIN}/user/${authorUsername}` : undefined,
  },
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
    logo: { "@type": "ImageObject", url: LOGO_IMAGE },
  },
});

export default useSeo;
