import { supabase } from '@/lib/supabase';

export type ActivityPushKind = 'like' | 'comment' | 'comment_reply' | 'follow';

export type ActivityPushPayload = {
  kind: ActivityPushKind;
  postId?: string | number;
  commentId?: string | number;
  parentCommentId?: string | number;
  followingUsername?: string;
  bodyPreview?: string;
};

const BAGGED_API_BASE = (
  process.env.EXPO_PUBLIC_BAGGED_API_URL ?? 'https://bagged.vercel.app'
).replace(/\/$/, '');

/** Best-effort — notifies the recipient's registered devices via the Vercel push API. */
export async function queueActivityPush(payload: ActivityPushPayload): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;

    const res = await fetch(`${BAGGED_API_BASE}/api/send-activity-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('queueActivityPush:', res.status, text.slice(0, 160));
    }
  } catch (err) {
    console.warn('queueActivityPush:', err instanceof Error ? err.message : err);
  }
}
