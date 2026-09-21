/** When the rate modal saves, mounted tabs may stay under the stack — poke so they refetch. */
type Listener = () => void;

export type FeedPostPatch = {
  postId: string | number;
  commentsDelta?: number;
};

type PatchListener = (patch: FeedPostPatch) => void;

let feedListener: Listener | null = null;
let feedPatchListener: PatchListener | null = null;
let discoverListener: Listener | null = null;
let myListListener: Listener | null = null;
/** After a re-rank (or new rank), move this post's card to the top once the feed reloads. */
let pendingBringToTopPostId: string | null = null;

let pokeTimer: ReturnType<typeof setTimeout> | null = null;
const POKE_DEBOUNCE_MS = 500;

export function setFeedRefreshListener(fn: Listener | null): void {
  feedListener = fn;
}

export function setFeedPatchListener(fn: PatchListener | null): void {
  feedPatchListener = fn;
}

export function setDiscoverRefreshListener(fn: Listener | null): void {
  discoverListener = fn;
}

export function setMyListRefreshListener(fn: Listener | null): void {
  myListListener = fn;
}

/** Incremental feed card update — avoids a full Supabase refetch for likes/comments. */
export function patchFeedPost(patch: FeedPostPatch): void {
  feedPatchListener?.(patch);
}

function runPokeListeners(): void {
  feedListener?.();
  discoverListener?.();
  myListListener?.();
}

/**
 * Refetch feed, Discover, and My List from Supabase. If `postId` is set, that feed card
 * is moved to index 0 after the next load (covers replication lag).
 * Debounced so rapid calls (e.g. want-to-try toggles) do not stack heavy reloads.
 */
export function pokeFeedRefresh(postId?: string | number | null): void {
  if (postId != null && String(postId).trim() !== '') {
    pendingBringToTopPostId = String(postId);
  }
  if (pokeTimer) clearTimeout(pokeTimer);
  pokeTimer = setTimeout(() => {
    pokeTimer = null;
    runPokeListeners();
  }, POKE_DEBOUNCE_MS);
}

export function takePendingBringToTopPostId(): string | null {
  const v = pendingBringToTopPostId;
  pendingBringToTopPostId = null;
  return v;
}
