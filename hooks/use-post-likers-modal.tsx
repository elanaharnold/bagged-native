import { useCallback, useState } from 'react';

import { PostLikersModal } from '@/components/bagged/post-likers-modal';

export function usePostLikersModal(onPressUser: (username: string) => void) {
  const [postId, setPostId] = useState<string | number | null>(null);

  const showLikers = useCallback((id: string | number) => {
    setPostId(id);
  }, []);

  const closeLikers = useCallback(() => {
    setPostId(null);
  }, []);

  const modal = (
    <PostLikersModal
      visible={postId != null}
      postId={postId}
      onClose={closeLikers}
      onPressUser={onPressUser}
    />
  );

  return { showLikers, closeLikers, modal };
}
