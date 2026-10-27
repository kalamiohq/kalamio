/**
 * Query Key Factory
 *
 * Hierarchical key structure enables precise cache invalidation:
 *   - invalidateQueries({ queryKey: ['blogs'] })  → wipes ALL blog queries
 *   - invalidateQueries({ queryKey: queryKeys.blogs.detail('abc') }) → wipes one blog
 *
 * Rules:
 *   1. Every query in the app MUST use a key from this factory.
 *   2. Keys are arrays — TanStack Query matches by prefix.
 *   3. Filter objects use stable key order (pass as object, not spread).
 */
export const queryKeys = {

  // ── Blog / Feed ───────────────────────────────────────────────
  blogs: {
    all:          ()                => ['blogs'],
    latest:       ()                => ['blogs', 'latest'],
    trending:     ()                => ['blogs', 'trending'],
    category:     (tag)             => ['blogs', 'category', tag],
    following:    ()                => ['blogs', 'following'],
    detail:       (blogId)          => ['blogs', 'detail', blogId],
    similar:      (blogId)          => ['blogs', 'similar', blogId],
    search:       (query)           => ['blogs', 'search', query],
    userWritten:  (filters)         => ['blogs', 'user-written', filters],
    // filters = { draft, query, sort } — object for partial matching
  },

  // ── Users / Profiles ──────────────────────────────────────────
  users: {
    all:          ()                => ['users'],
    profile:      (username)        => ['users', 'profile', username],
    search:       (query)           => ['users', 'search', query],
    suggestions:  ()                => ['users', 'suggestions'],
  },

  // ── Social Graph ──────────────────────────────────────────────
  follow: {
    status:       (userId)          => ['follow', 'status', userId],
    // Order-independent single segment so [a,b] and [b,a] share one cache entry
    // and the key length stays fixed (avoids per-render key churn / orphans).
    batchStatus:  (userIds)         => ['follow', 'batch', [...(userIds || [])].sort().join(',')],
    followsBack:  (userId)          => ['follow', 'follows-back', userId],
  },

  subscribe: {
    status:       (pubId)           => ['subscribe', 'status', pubId],
    mySubscriptions: ()             => ['subscribe', 'my-subscriptions'],
    feed:         ()                => ['subscribe', 'feed'],
  },

  // ── Engagement ────────────────────────────────────────────────
  likes: {
    status:       (blogId)          => ['likes', 'status', blogId],
  },

  // ── Collections / Bookmarks ───────────────────────────────────
  collections: {
    all:          ()                => ['collections'],
    user:         (username)        => ['collections', 'user', username],
    detail:       (collectionId)    => ['collections', 'detail', collectionId],
    isSaved:      (blogId)          => ['collections', 'is-saved', blogId],
    forArticle:   (blogId)          => ['collections', 'article', blogId],
  },

  // ── Notifications ─────────────────────────────────────────────
  notifications: {
    all:          ()                => ['notifications'],
    list:         (filter)          => ['notifications', 'list', filter],
    unread:       ()                => ['notifications', 'unread'],
  },

  // ── Messages ──────────────────────────────────────────────────
  messages: {
    all:          ()                => ['messages'],
    unreadTotal:  ()                => ['messages', 'unread-total'],
    conversations:()                => ['messages', 'conversations'],
    thread:       (conversationId)  => ['messages', 'thread', conversationId],
  },

  // ── Publications ──────────────────────────────────────────────
  publications: {
    all:          ()                => ['publications'],
    user:         (userId)          => ['publications', 'user', userId],
    detail:       (slug)            => ['publications', 'detail', slug],
  },

  // ── Analytics ─────────────────────────────────────────────────
  analytics: {
    all:          ()                => ['analytics'],
    dashboard:    (range)           => ['analytics', 'dashboard', range],
  },

  // ── Comments ──────────────────────────────────────────────────
  comments: {
    forBlog:      (blogId)          => ['comments', blogId],
    thread:       (commentId)       => ['comments', 'thread', commentId],
  },

  // ── Polls ─────────────────────────────────────────────────────
  polls: {
    voteStatus:   (blogId)          => ['polls', 'vote', blogId],
    voters:       (blogId)          => ['polls', 'voters', blogId],
  },

  // ── Block ─────────────────────────────────────────────────────
  block: {
    status:       (userId)          => ['block', 'status', userId],
    list:         ()                => ['block', 'list'],
  },

  // ── Reads / Reading History ───────────────────────────────────
  reads: {
    all:          ()                => ['reads'],
    history:      ()                => ['reads', 'history'],
  },

  // ── Subscriptions ─────────────────────────────────────────────
  subscriptions: {
    all:          ()                => ['subscriptions'],
    feed:         ()                => ['subscriptions', 'feed'],
  },

  // ── Settings ──────────────────────────────────────────────────
  settings: {
    notificationPrefs: ()           => ['settings', 'notification-prefs'],
    privacy:           ()           => ['settings', 'privacy'],
    account:           ()           => ['settings', 'account'],
  },

  // ── AI assistant ──────────────────────────────────────────────
  ai: {
    settings:     ()                => ['ai', 'settings'],
  },
};
