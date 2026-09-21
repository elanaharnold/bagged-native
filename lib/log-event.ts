import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const APP_VERSION = Constants.expoConfig?.version ?? 'unknown';
const APP_BUILD = String(
  Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? ''
);

/** Fire-and-forget analytics insert — never throws. */
export function logEvent(eventName: string, properties?: Record<string, unknown>): void {
  void (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const { error } = await supabase.from('user_events').insert({
        user_id: userId,
        event_name: eventName,
        properties: {
          app_version: APP_VERSION,
          build: APP_BUILD,
          platform: Platform.OS,
          ...(properties ?? {}),
        },
        created_at: new Date().toISOString(),
      });
      if (error && __DEV__) {
        console.warn('[logEvent]', eventName, error.message);
      }
    } catch {
      // fail silently
    }
  })();
}
