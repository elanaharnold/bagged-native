import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

import { fetchProfileById } from '@/lib/data';
import { logEvent } from '@/lib/log-event';
import {
  registerForPushNotificationsAsync,
  removePushToken,
  upsertPushToken,
} from '@/lib/push-notifications';
import { useAuth } from '@/providers/auth-provider';

type PushData = {
  kind?: string;
  postId?: string;
  commentId?: string;
  postItem?: string;
  userId?: string;
};

function navigateFromPush(router: ReturnType<typeof useRouter>, data: PushData) {
  const kind = String(data.kind ?? '');
  if (kind === 'referral') {
    const referredUserId = String(data.userId ?? '').trim();
    if (!referredUserId) {
      router.push('/notifications');
      return;
    }
    void fetchProfileById(referredUserId).then((profile) => {
      const username = String(profile?.username ?? '').trim();
      if (username) {
        router.push({ pathname: '/user/[username]', params: { username } });
      } else {
        router.push('/notifications');
      }
    });
    return;
  }
  if (kind === 'follow') {
    router.push('/notifications');
    return;
  }
  if (kind === 'feed') {
    router.push('/(tabs)/index');
    return;
  }
  if (data.postId && (kind === 'comment' || kind === 'comment_reply' || kind === 'like')) {
    if (kind === 'comment' || kind === 'comment_reply') {
      router.push({
        pathname: '/comments/[postId]',
        params: {
          postId: String(data.postId),
          postItem: data.postItem ?? '',
          highlightCommentId: data.commentId ?? '',
        },
      });
      return;
    }
    router.push('/notifications');
    return;
  }
  router.push('/notifications');
}

export function PushNotificationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { userId } = useAuth();
  const tokenRef = useRef<string | null>(null);
  const registeredForUserRef = useRef<string | null>(null);
  const registeringRef = useRef(false);
  /** Avoid navigating twice when cold-start + live listener both see the same tap. */
  const handledResponseIdsRef = useRef(new Set<string>());

  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const id = String(response.notification.request.identifier ?? '');
      if (id && handledResponseIdsRef.current.has(id)) return;
      if (id) handledResponseIdsRef.current.add(id);
      const data = (response.notification.request.content.data ?? {}) as PushData;
      logEvent('push_opened', { kind: String(data.kind ?? 'unknown') });
      navigateFromPush(router, data);
    },
    [router]
  );

  const syncPushToken = useCallback(async (uid: string) => {
    if (registeringRef.current) return;
    registeringRef.current = true;
    try {
      const token = await registerForPushNotificationsAsync();
      if (!token) return;
      tokenRef.current = token;
      registeredForUserRef.current = uid;
      await upsertPushToken(uid, token, Platform.OS);
    } finally {
      registeringRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      const prevToken = tokenRef.current;
      const prevUser = registeredForUserRef.current;
      if (prevToken && prevUser) {
        void removePushToken(prevUser, prevToken);
      }
      tokenRef.current = null;
      registeredForUserRef.current = null;
      return;
    }

    let cancelled = false;
    void syncPushToken(userId).finally(() => {
      if (cancelled) return;
    });

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && !cancelled) {
        void syncPushToken(userId);
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [userId, syncPushToken]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response);
    });
    return () => sub.remove();
  }, [handleNotificationResponse]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (cancelled || !response) return;
      await Notifications.clearLastNotificationResponseAsync();
      if (cancelled) return;
      handleNotificationResponse(response);
    })();
    return () => {
      cancelled = true;
    };
  }, [handleNotificationResponse]);

  return children;
}
