/** When the rate modal saves, the Feed tab may stay mounted under the stack — poke so it refetches. */
type Listener = () => void;

let listener: Listener | null = null;
/** After a re-rank (or new rank), move this post’s card to the top once the feed reloads. */
let pendingBringToTopPostId: string | null = null;

export function setFeedRefreshListener(fn: Listener | null): void {
  listener = fn;
}

/**
 * Refetch the feed. If `postId` is set, that card is moved to index 0 after the next load
 * (covers replication lag and any ordering edge cases).
 */
export function pokeFeedRefresh(postId?: string | number | null): void {
  if (postId != null && String(postId).trim() !== '') {
    pendingBringToTopPostId = String(postId);
  }
  listener?.();
}

export function takePendingBringToTopPostId(): string | null {
  const v = pendingBringToTopPostId;
  pendingBringToTopPostId = null;
  return v;
}
