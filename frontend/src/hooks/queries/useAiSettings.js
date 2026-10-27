import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../common/api';
import { queryKeys } from '../../common/queryKeys';
import { UserContext } from '../../App';

/**
 * The AI assistant's provider catalog plus this user's connected providers.
 *
 * API contract (server/controllers/ai.controller.js):
 *   POST `/ai/settings` → `{ enabled, catalog: [{ id, name, keyPrefix, keysUrl, models }],
 *                           active_provider, providers: [{ provider, model, key_last4, updated_at }] }`
 * Keys are stored encrypted on the server and never returned — only their last 4 characters.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult}
 */
export const useAiSettings = () => {
  const { userAuth: { access_token } } = useContext(UserContext);

  return useQuery({
    queryKey: queryKeys.ai.settings(),
    queryFn: async () => (await api.post('/ai/settings')).data,
    enabled: !!access_token,
    staleTime: 5 * 60 * 1000,
  });
};
