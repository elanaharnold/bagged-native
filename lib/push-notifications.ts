import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { logEvent } from '@/lib/log-event';
import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    undefined
  );
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Activity',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
    logEvent('push_permission_result', { status });
  }
  if (finalStatus !== 'granted') {
    return null;
  }

  const pid = projectId();
  if (!pid) {
    console.warn('push: missing EAS projectId in app config');
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId: pid });
  return token.data ?? null;
}

export async function upsertPushToken(
  userId: string,
  expoPushToken: string,
  platform: string
): Promise<void> {
  const { error } = await supabase.from('push_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      platform,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,expo_push_token' }
  );
  if (error) {
    console.warn('upsertPushToken:', error.message);
  }
}

export async function removePushToken(userId: string, expoPushToken: string): Promise<void> {
  const { error } = await supabase
    .from('push_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('expo_push_token', expoPushToken);
  if (error) {
    console.warn('removePushToken:', error.message);
  }
}
