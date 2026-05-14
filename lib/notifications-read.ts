import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'bagged_notifications_last_read_ms';

export async function getNotificationsLastReadMs(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function setNotificationsLastReadNow(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

const badgeListeners = new Set<() => void>();

/** Tab bar / hooks subscribe so the dot can refresh after the notifications modal closes. */
export function subscribeNotificationsBadgeRefresh(listener: () => void): () => void {
  badgeListeners.add(listener);
  return () => badgeListeners.delete(listener);
}

export function emitNotificationsBadgeRefresh(): void {
  badgeListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}
