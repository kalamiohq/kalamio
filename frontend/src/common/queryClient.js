import { QueryClient } from '@tanstack/react-query';

/**
 * Retry policy for queries.
 *
 * - 4xx (client errors) are deterministic — a retry will fail the same way, so
 *   we bail immediately. This also avoids hammering the server on 404/403/422.
 * - 401 is already resolved by the Axios interceptor (refresh + replay); by the
 *   time React Query sees one, refresh has failed, so retrying is pointless.
 * - Network errors and 5xx are transient — retry up to 2 times with backoff.
 */
const retryQuery = (failureCount, error) => {
  // Dead session: the Axios interceptor exhausted its refresh and already
  // redirected to sign-in. Retrying only re-hits 401 (this error has no
  // .response, so the 4xx check below would otherwise let it slip through).
  if (error?.__sessionExpired) return false;
  const status = error?.response?.status;
  if (status >= 400 && status < 500) return false;
  return failureCount < 2;
};

// Exponential backoff, capped at 30s: 1s → 2s → (cap).
const retryDelay = (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30_000);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,       // 2 min — data considered fresh
      gcTime: 30 * 60 * 1000,          // 30 min — unused cache kept in memory
      retry: retryQuery,               // Skip 4xx, back off on network/5xx (Axios handles 401)
      retryDelay,
      refetchOnWindowFocus: false,      // Don't refetch on tab focus — it re-renders feeds and
                                        // visibly reloads images on every tab return. Live badges
                                        // (notifications, messages) poll on their own; feeds
                                        // refetch on mount/navigation and after staleTime.
      refetchOnReconnect: true,         // Refetch when coming back online
      throwOnError: false,              // Let components handle via isError
      networkMode: 'online',            // Don't attempt fetches while offline
    },
    mutations: {
      retry: 0,                         // Never auto-retry mutations
      networkMode: 'online',
    },
  },
});
