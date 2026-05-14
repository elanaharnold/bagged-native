import { useLocalSearchParams, useRouter } from 'expo-router';

import { ProfileView } from '@/components/bagged/profile-view';

export default function UserProfileScreen() {
  const router = useRouter();
  const { username } = useLocalSearchParams<{ username: string }>();
  const handle = String(username ?? '').trim();

  // We deliberately render in "other user" mode here even when the visitor
  // taps their own avatar — they have a dedicated tab for the self profile.
  return (
    <ProfileView
      username={handle}
      isSelf={false}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
    />
  );
}
