import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  logIn as authLogIn,
  logOut as authLogOut,
  requestPasswordReset as authRequestPasswordReset,
  signUp as authSignUp,
  updatePassword as authUpdatePassword,
} from '@/lib/auth';
import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  /** False until we've resolved the initial session (loading splash key). */
  ready: boolean;
  session: Session | null;
  userId: string | null;
  signIn: (args: { email: string; password: string }) => Promise<void>;
  signUp: (args: { email: string; password: string; username: string }) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      session,
      userId: session?.user?.id ?? null,
      signIn: async ({ email, password }) => {
        await authLogIn({ email, password });
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
      signOut: async () => {
        await authLogOut();
      },
    }),
    [ready, session]
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
