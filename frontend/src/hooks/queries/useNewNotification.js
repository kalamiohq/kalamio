import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../common/api';
import { queryKeys } from '../../common/queryKeys';
import { UserContext } from '../../App';

/**
 * Checks whether new (unread) notifications are available.
 * Polls every 60 seconds. On the Messages page, where the socket is open, updates arrive sooner.
 *
 * Returns the full data object which contains `new_notification_available`.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult}
 */
const useNewNotification = () => {
  const { userAuth: { access_token } } = useContext(UserContext);

  return useQuery({
    queryKey: queryKeys.notifications.unread(),

    queryFn: async () => {
      const { data } = await api.get('/new-notification');
      return data;
    },

    enabled: !!access_token,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
};

export default useNewNotification;
