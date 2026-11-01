import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../common/api';
import { queryKeys } from '../../common/queryKeys';
import { UserContext } from '../../App';

/**
 * A published post's like/comment counts and poll tally, for signed-in readers.
 * Polls every 60 seconds while the tab is visible.
 *
 * @param {string} [blogId] - The post's blog_id. Falsy (or signed out) disables the query.
 * @returns {import('@tanstack/react-query').UseQueryResult<{activity: object, poll?: object}>}
 */
const useBlogActivity = (blogId) => {
  const { userAuth: { access_token } } = useContext(UserContext);

  return useQuery({
    queryKey: queryKeys.blogs.activity(blogId),

    queryFn: async () => {
      const { data } = await api.post('/blog-activity', { blog_id: blogId });
      return data;
    },

    enabled: !!access_token && !!blogId,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  });
};

export default useBlogActivity;
