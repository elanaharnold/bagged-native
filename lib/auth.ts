import type { Session, User } from '@supabase/supabase-js';

import { supabase } from './supabase';

export type Profile = {
  id: string;
  username: string | null;
  avatar_color: string | null;
  onboarding_complete?: boolean | null;
  [key: string]: unknown;
};

type SignUpArgs = { email: string; password: string; username: string };
type LogInArgs = { email: string; password: string };

/**
 * Mirrors the web `signUp`. Stores `username` (lowercased) and
 * `onboarding_complete: false` in user metadata so the post-login flow can
 * resume onboarding for new accounts.
 */
export async function signUp({ email, password, username }: SignUpArgs) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username.toLowerCase(),
        onboarding_complete: false,
      },
    },
  });

  if (error) {
    const m = error.message ?? '';
    if (
      m.includes('already registered') ||
      m.includes('already been registered') ||
      m.includes('User already registered')
    ) {
      throw new Error('An account with this email already exists — try logging in');
    }
    throw error;
  }
  return data;
}

export async function logIn({ email, password }: LogInArgs) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/**
 * Web sets a `redirectTo` so the email link returns to the SPA. Mobile email
 * links open in the default browser; recovery on device requires a deep link
 * scheme + `Linking` handling, which isn't wired yet — passing no override
 * lets Supabase fall back to the dashboard-configured site URL.
 */
export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(String(email ?? '').trim());
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/**
 * Best-effort server-side cleanup. If the project has no `delete_account` RPC,
 * callers should surface a friendly fallback message.
 */
export async function requestAccountDeletionRpc(): Promise<void> {
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
}

export async function logOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

export async function getCurrentUser(): Promise<User | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getMyProfile(): Promise<Profile | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return data as Profile;
}

/** Onboarding flag lives in user metadata (`false` until the user finishes). */
export function isOnboardingIncomplete(session: Session | null): boolean {
  const meta = session?.user?.user_metadata;
  if (!meta || typeof meta !== 'object') return false;
  return (
    Object.prototype.hasOwnProperty.call(meta, 'onboarding_complete') &&
    (meta as { onboarding_complete?: unknown }).onboarding_complete === false
  );
}
