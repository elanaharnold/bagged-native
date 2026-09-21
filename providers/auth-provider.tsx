import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  authRedirectLooksLikePasswordRecovery,
  establishSessionFromAuthRedirectUrl,
  logIn as authLogIn,
  logOut as authLogOut,
  markFindPeopleSeen as authMarkFindPeopleSeen,
  markOnboardingComplete as authMarkOnboardingComplete,
  requestPasswordReset as authRequestPasswordReset,
  resolveValidSession,
  signUp as authSignUp,
  updatePassword as authUpdatePassword,
  usernameFromSession,
} from '@/lib/auth';
import { ensureMandatoryFollowRow, ensureProfileForUser } from '@/lib/data';
import { removePushToken } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  /** False until we've resolved the initial session (loading splash key). */
  ready: boolean;
  session: Session | null;
  userId: string | null;
  /** Resolved from `profiles.username`. Null while loading or signed out. */
  username: string | null;
  signIn: (args: { email: string; password: string }) => Promise<void>;
  signUp: (args: { email: string; password: string; username: string }) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  markOnboardingComplete: () => Promise<void>;
  markFindPeopleSeen: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const valid = await resolveValidSession(data.session ?? null);
      if (cancelled) return;
      setSession(valid);
      setReady(true);
    })().catch((err) => {
      console.warn('auth bootstrap:', err instanceof Error ? err.message : err);
      if (!cancelled) {
        setSession(null);
        setReady(true);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setUsername(null);
        return;
      }
      void resolveValidSession(next ?? null).then((valid) => {
        if (cancelled) return;
        setSession(valid);
      });
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/(auth)/reset-password');
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    const handleAuthRedirect = async (url: string) => {
      if (!authRedirectLooksLikePasswordRecovery(url)) return;
      try {
        const established = await establishSessionFromAuthRedirectUrl(url);
        if (established) {
          router.replace('/(auth)/reset-password');
        }
      } catch (err) {
        console.warn('password reset deep link:', err instanceof Error ? err.message : err);
      }
    };

    Linking.getInitialURL()
      .then((url) => {
        if (url) void handleAuthRedirect(url);
      })
      .catch((err) => console.warn('Linking.getInitialURL:', err));

    const sub = Linking.addEventListener('url', (event) => {
      void handleAuthRedirect(event.url);
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) {
      setUsername(null);
      return;
    }
    ensureMandatoryFollowRow(uid).catch((err) =>
      console.warn('ensureMandatoryFollowRow:', err instanceof Error ? err.message : err)
    );
    let cancelled = false;
    ensureProfileForUser(uid)
      .then((profile) => {
        if (cancelled) return;
        const name =
          profile?.username?.trim() || usernameFromSession(session) || null;
        setUsername(name);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('ensureProfileForUser:', err instanceof Error ? err.message : err);
        setUsername(usernameFromSession(session));
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      userId: session?.user?.id ?? null,
      username,
      signIn: async ({ email, password }) => {
        await authLogIn({ email, password });
        const {
          data: { session: next },
        } = await supabase.auth.getSession();
        const valid = await resolveValidSession(next ?? null);
        if (!valid) {
          throw new Error('Could not start a session — try again.');
        }
        setSession(valid);
      },
      signUp: async ({ email, password, username }) => {
        await authSignUp({ email, password, username });
      },
      requestPasswordReset: async (email: string) => {
        await authRequestPasswordReset(email);
      },
      updatePassword: async (newPassword: string) => {
        await authUpdatePassword(newPassword);
      },
      markOnboardingComplete: async () => {
        await authMarkOnboardingComplete();
        const {
          data: { session: next },
        } = await supabase.auth.getSession();
        const valid = await resolveValidSession(next ?? null);
        setSession(valid);
      },
      markFindPeopleSeen: async () => {
        await authMarkFindPeopleSeen();
        const {
          data: { session: next },
        } = await supabase.auth.getSession();
        const valid = await resolveValidSession(next ?? null);
        setSession(valid);
      },
      signOut: async () => {
        const uid = session?.user?.id;
        try {
          const Notifications = await import('expo-notifications');
          const Constants = await import('expo-constants');
          const pid =
            Constants.default.expoConfig?.extra?.eas?.projectId ??
            Constants.default.easConfig?.projectId;
          if (uid && pid) {
            const perm = await Notifications.getPermissionsAsync();
            if (perm.status === 'granted') {
              const push = await Notifications.getExpoPushTokenAsync({ projectId: pid });
              if (push.data) await removePushToken(uid, push.data);
            }
          }
        } catch {
          /* best-effort */
        }
        await authLogOut();
        setUsername(null);
        router.replace('/(auth)/welcome');
      },
    }),
    [ready, session, username, router, session?.user?.id]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
