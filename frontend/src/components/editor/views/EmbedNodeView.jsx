import { memo, useCallback, useMemo } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import Icon from '../../Icon';
import { EMBED_PROVIDERS } from '../extensions/embed-registry';

/* ── Inline SVG logos for each platform (24×24, white fill) ────────── */
const LOGOS = {
  youtube: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>')}`,
  twitter: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>')}`,
  github: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>')}`,
  spotify: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>')}`,
  loom: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5 13h-4l2 3.464-1.732 1L11.268 14H7.268l1-1.732L12 12l-3.732-.268-1-1.732h4l-2-3.464L11 5.536 12.732 9H16.732l-1 1.732L12 12l3.732.268 1 1.732z"/></svg>')}`,
  instagram: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>')}`,
  linkedin: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>')}`,
  reddit: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 000-.463.327.327 0 00-.462 0c-.545.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.205-.094z"/></svg>')}`,
  codepen: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M18.144 13.067v-2.134L16.55 12zm1.812-1.592L24 7.6v8.8l-4.044-3.875zM12 2.175l6.194 4.138-2.747 2.01L12 5.97 8.553 8.323 5.806 6.313zM7.428 10.59l-1.595 1.41 1.595 1.41v-2.82zm-1.616 1.885L1.812 16.4v-8.8l4 3.875zm6.188-1.41L8.553 8.767l-2.747 2.01 3.44 2.488zm0 3.87l-3.44 2.488 2.747 2.01L12 18.03l3.447-2.353 2.747-2.01zm6.188-3.87l3.44 2.488-2.747 2.01-3.44-2.488z"/></svg>')}`,
  figma: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M15.852 8.981h-4.588V0h4.588c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.491-4.49 4.491zM12.735 7.51h3.117c1.665 0 3.019-1.355 3.019-3.019s-1.355-3.019-3.019-3.019h-3.117V7.51zm0 8.137h-4.588c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h4.588v8.98zM4.838 11.157c0 1.665 1.354 3.02 3.019 3.02h3.117V8.138H7.857c-1.665 0-3.019 1.354-3.019 3.019zm3.019 7.51c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h4.588v4.49c0 2.476-2.014 4.49-4.588 4.49zm0-1.471c1.665 0 3.019-1.355 3.019-3.019v-3.019H7.857c-1.665 0-3.019 1.354-3.019 3.019s1.354 3.019 3.019 3.019zm7.863-6.039c2.476 0 4.49 2.015 4.49 4.49s-2.014 4.49-4.49 4.49-4.49-2.014-4.49-4.49 2.014-4.49 4.49-4.49zm0 7.509c1.665 0 3.019-1.354 3.019-3.019s-1.354-3.019-3.019-3.019-3.019 1.354-3.019 3.019 1.354 3.019 3.019 3.019z"/></svg>')}`,
  tiktok: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>')}`,
  threads: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017C1.5 8.418 2.35 5.564 3.995 3.516 5.845 1.212 8.598.031 12.18.007h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.739.739c-1.089-3.916-3.75-5.561-6.596-5.581-2.658.018-4.67.87-5.969 2.535C5.935 7.01 5.274 9.316 5.253 11.99v.025c.02 2.673.681 4.979 1.973 6.725 1.298 1.665 3.311 2.517 5.97 2.535 2.04-.017 3.59-.453 4.898-1.37 1.407-.99 2.116-2.348 2.116-4.041 0-1.19-.37-2.137-1.1-2.816-.646-.6-1.524-.963-2.577-1.065a7.89 7.89 0 01.082 1.095c0 .63-.068 1.2-.204 1.706-.36 1.328-1.241 2.072-2.478 2.072-.862 0-1.57-.342-2.04-.987-.377-.514-.567-1.137-.567-1.852 0-1.754 1.302-3.207 3.002-3.342a5.854 5.854 0 012.134.188c-.025-.8-.208-1.402-.553-1.828-.456-.562-1.19-.851-2.183-.86-.77.007-1.467.186-2.07.532a3.81 3.81 0 00-1.093.886l-1.815-1.962c.554-.613 1.254-1.127 2.08-1.527.958-.462 2.064-.705 3.286-.722h.033c1.535.025 2.794.483 3.741 1.362 1.018.943 1.57 2.257 1.637 3.898.025.052.042.104.052.157a7.766 7.766 0 01.107 1.3c0 2.474-.853 4.498-2.536 6.012-1.56 1.404-3.587 2.168-6.03 2.276z"/></svg>')}`,
  facebook: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>')}`,
};

const BRAND_COLORS = {
  youtube: '#FF0000', twitter: '#000000', github: '#24292e', 'github-gist': '#24292e',
  'github-repo': '#24292e', 'github-profile': '#24292e',
  spotify: '#1DB954', loom: '#625DF5',
  instagram: '#E1306C', 'instagram-profile': '#E1306C',
  linkedin: '#0077B5', 'linkedin-profile': '#0077B5', 'linkedin-company': '#0077B5',
  reddit: '#FF4500', 'reddit-subreddit': '#FF4500',
  codepen: '#1E1F26', figma: '#A259FF',
  tiktok: '#000000', 'tiktok-profile': '#000000',
  threads: '#000000', 'threads-profile': '#000000',
  facebook: '#1877F2',
};

/* ── Derive a human-readable title from the URL + provider ─────────── */
function getTitle(provider, url, embedId) {
  const slug = (pattern) => {
    const m = url?.match(pattern);
    return m ? m[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;
  };
  switch (provider) {
    case 'youtube': return 'YouTube Video';
    case 'twitter': return embedId ? (embedId.match(/^\d+$/) ? 'Tweet' : `@${embedId}`) : 'X / Twitter';
    case 'github-gist': return 'GitHub Gist';
    case 'github-repo': return embedId || 'GitHub Repo';
    case 'github-profile': return embedId || 'GitHub Profile';
    case 'spotify': return 'Spotify';
    case 'loom': return 'Loom Video';
    case 'instagram': return 'Instagram Post';
    case 'instagram-profile': return slug(/instagram\.com\/([^/?]+)/) || 'Instagram';
    case 'linkedin': return 'LinkedIn Post';
    case 'linkedin-profile': return slug(/\/in\/([^/?]+)/) || 'LinkedIn Profile';
    case 'linkedin-company': return slug(/\/company\/([^/?]+)/) || 'LinkedIn Company';
    case 'reddit': return 'Reddit Post';
    case 'reddit-subreddit': return `r/${embedId}` || 'Subreddit';
    case 'codepen': return 'CodePen';
    case 'figma': return 'Figma Design';
    case 'tiktok': return 'TikTok Video';
    case 'tiktok-profile': return slug(/tiktok\.com\/@([^/?]+)/) || 'TikTok';
    case 'threads': return 'Threads Post';
    case 'threads-profile': return slug(/threads\.net\/@([^/?]+)/) || 'Threads';
    case 'facebook': return 'Facebook Post';
    default: return 'Link';
  }
}

/* ── Minimal Embed Card ───────────────────────────────────────────── */
const MiniEmbedCard = memo(({ url, provider, embedId }) => {
  const logoKey = provider?.replace(/-profile$|-company$|-subreddit$/, '') || provider;
  const logo = LOGOS[logoKey] || null;
  const color = BRAND_COLORS[provider] || '#666';
  const title = getTitle(provider, url, embedId);

  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px',
        padding: '8px 14px 8px 10px',
        borderRadius: '8px', textDecoration: 'none',
        border: '1px solid rgb(var(--c-border))',
        backgroundColor: 'rgb(var(--c-surface))',
        color: 'rgb(var(--c-black))',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '14px', fontWeight: 500,
        transition: 'box-shadow 0.15s, transform 0.15s',
        maxWidth: '100%',
        cursor: 'grab',
      }}>
      {logo && (
        <span style={{
          width: '28px', height: '28px', borderRadius: '6px',
          background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <img src={logo} alt="" style={{ width: '16px', height: '16px' }} />
        </span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      <span style={{ color: 'rgb(var(--c-dark-grey))', fontSize: '13px', flexShrink: 0 }}>→</span>
    </a>
  );
});
MiniEmbedCard.displayName = 'MiniEmbedCard';

/* ── Providers that have native iframe embeds ─────────────────────── */
const IFRAME_PROVIDERS = new Set(['youtube', 'spotify', 'loom', 'codepen', 'figma']);

const EmbedNodeView = memo(({ node, deleteNode }) => {
  const { provider, url, embedId } = node.attrs;

  const providerInfo = EMBED_PROVIDERS[provider] || { label: 'Link', icon: 'link' };
  const embedUrl = providerInfo.embedUrl ? providerInfo.embedUrl(embedId) : null;
  const isMiniCard = !embedUrl;

  const handleDelete = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    deleteNode();
  }, [deleteNode]);

  return (
    <NodeViewWrapper
      className={`embed-node-view group relative ${isMiniCard ? 'embed-mini' : 'my-4'}`}
      data-drag-handle=""
      style={isMiniCard ? { display: 'inline-block', marginRight: '8px', marginBottom: '8px', verticalAlign: 'top' } : undefined}
    >
      <button
        type="button"
        className="absolute -top-3 -right-3 z-10 opacity-0 group-hover:opacity-100 bg-red-500 text-white rounded-full p-1.5 shadow-md transition-opacity"
        onClick={handleDelete}
        title="Remove embed"
        aria-label="Remove embed"
      >
        <Icon name="close" className="text-sm" />
      </button>

      {embedUrl ? (
        <div className="w-full relative overflow-hidden rounded-md border border-border bg-surface">
          <iframe
            src={embedUrl}
            className="w-full aspect-video border-0"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            title={`${providerInfo.label} Embed`}
          />
        </div>
      ) : (
        <MiniEmbedCard url={url} provider={provider} embedId={embedId} />
      )}
    </NodeViewWrapper>
  );
});

EmbedNodeView.displayName = 'EmbedNodeView';

export default EmbedNodeView;
