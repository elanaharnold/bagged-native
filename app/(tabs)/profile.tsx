import { ProfileView } from '@/components/bagged/profile-view';
import { BaggedLayout } from '@/constants/bagged-theme';
import { usernameFromSession } from '@/lib/auth';
import { useAuth } from '@/providers/auth-provider';

/** Own profile tab — `ProfileView` loads by `userId` when `isSelf`. */
export default function SelfProfileTab() {
  const { userId, session, username: authUsername } = useAuth();
  const handle = authUsername || usernameFromSession(session) || '';

  if (!userId) {
    return null;
  }

  return (
    <ProfileView
      username={handle}
      isSelf
      omitTopSafeArea
      extraBottomInset={BaggedLayout.rateFabListInset}
    />
  );
}
