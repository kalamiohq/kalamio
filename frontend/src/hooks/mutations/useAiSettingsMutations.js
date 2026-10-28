import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../common/api';
import { queryKeys } from '../../common/queryKeys';

// Both endpoints answer with the full, updated settings payload, so it's written straight into the
// cache instead of refetching.
const useAiSettingsMutation = (endpoint) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body) => (await api.post(endpoint, body)).data,
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.ai.settings(), settings),
  });
};

/**
 * Add/replace a provider key and/or change its model; also makes it the active provider.
 * `mutate({ provider, model, apiKey? })` — omit `apiKey` to keep the saved key.
 */
export const useUpdateAiProvider = () => useAiSettingsMutation('/ai/settings/update');

/** Delete a provider's stored key. `mutate({ provider })` */
export const useRemoveAiProvider = () => useAiSettingsMutation('/ai/settings/remove');

/** Server error → one line of user-facing copy (Zod details first, then the API's own message). */
export const aiErrorMessage = (error, fallback = 'Something went wrong. Please try again.') =>
  error?.response?.data?.details?.[0]?.message || error?.response?.data?.error || fallback;
