import { Alert } from 'react-native';

import { deleteUserRankedPost } from '@/lib/data';
import { pokeFeedRefresh } from '@/lib/feed-refresh-poke';
import { formatProductDisplayName } from '@/lib/format';

/** Confirm, delete a ranked post, refresh feed listeners, then run `onSuccess`. */
export function confirmAndDeleteRankedPost(
  userId: string,
  row: { id: string | number; item: string },
  onSuccess?: () => void
): void {
  const name = formatProductDisplayName(row.item);
  Alert.alert(
    'Delete ranking?',
    `Remove "${name}" from your list? This can't be undone.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteUserRankedPost(userId, row.id);
              pokeFeedRefresh();
              onSuccess?.();
            } catch (e) {
              Alert.alert(
                'Could not delete',
                e instanceof Error ? e.message : 'Please try again.'
              );
            }
          })();
        },
      },
    ]
  );
}
