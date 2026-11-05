import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../common/api';
import { queryKeys } from '../../common/queryKeys';
import { UserContext } from '../../App';

/**
 * Fetches the total count of unread messages for the current user.
 * Polls every 60 seconds. On the Messages page, where the socket is open, updates arrive sooner.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult<number>}
 */
const useUnreadMessages = () => {
  const { userAuth: { access_token } } = useContext(UserContext);

  return useQuery({
    queryKey: queryKeys.messages.unreadTotal(),

    queryFn: async () => {
      const { data } = await api.post('/messages/unread-total');
      return data.unread_total || 0;
    },

    enabled: !!access_token,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
};

export default useUnreadMessages;
