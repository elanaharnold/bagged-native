import { useEffect, useState } from 'react';

import { fetchActivityNotifications, fetchProfileById } from '@/lib/data';
import {
  getNotificationsLastReadMs,
  subscribeNotificationsBadgeRefresh,
} from '@/lib/notifications-read';

/**
 * Polls whether there is activity newer than the last-read marker.
 * `refreshSeq` should change when you want a fresh check (e.g. tab change).
 * Also refetches when `emitNotificationsBadgeRefresh` runs (notifications modal closed).
 */
export function useNotificationUnread(
  userId: string | null | undefined,
  refreshSeq: number
): boolean {
  const [unread, setUnread] = useState(false);
  const [modalCloseToken, setModalCloseToken] = useState(0);

  useEffect(() => {
    return subscribeNotificationsBadgeRefresh(() => {
      setModalCloseToken((t) => t + 1);
    });
  }, []);

  useEffect(() => {
    if (!userId) {
      setUnread(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [lastRead, prof] = await Promise.all([
          getNotificationsLastReadMs(),
          fetchProfileById(userId),
        ]);
        if (cancelled) return;
        const un = prof?.username ?? '';
        if (!un) {
          setUnread(false);
          return;
        }
        const items = await fetchActivityNotifications(userId, un);
        if (cancelled) return;
        const has = items.some((i) => new Date(i.createdAt).getTime() > lastRead);
        setUnread(has);
      } catch {
        if (!cancelled) setUnread(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshSeq, modalCloseToken]);

  return unread;
}
