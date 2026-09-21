import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

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
        find_people_seen: false,
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
 * Where Supabase sends users after tapping the reset link in email.
 * Must be listed in Supabase Dashboard → Auth → URL Configuration → Redirect URLs.
 */
export function passwordResetRedirectUrl(): string {
  return Linking.createURL('reset-password');
}

/** Parse `#` or `?` auth callback params from a Supabase email deep link. */
export function parseAuthRedirectParams(url: string): Record<string, string> {
  const normalized = url.includes('#') ? url.replace('#', '?') : url;
  const qIdx = normalized.indexOf('?');
  if (qIdx === -1) return {};
  const params = new URLSearchParams(normalized.slice(qIdx + 1));
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/** Exchange tokens/code from a reset email link for a recovery session. */
export async function establishSessionFromAuthRedirectUrl(url: string): Promise<boolean> {
  const params = parseAuthRedirectParams(url);
  if (params.error) {
    throw new Error(params.error_description || params.error);
  }

  const code = params.code;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }

  const access_token = params.access_token;
  const refresh_token = params.refresh_token;
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return true;
  }

  return false;
}

export function authRedirectLooksLikePasswordRecovery(url: string): boolean {
  return /type=recovery|reset-password|access_token=|refresh_token=|code=/i.test(url);
}

export async function requestPasswordReset(email: string) {
  const redirectTo = passwordResetRedirectUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(String(email ?? '').trim(), {
    redirectTo,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Must match migration 063 `delete_account(confirmation text)`. */
export const DELETE_ACCOUNT_CONFIRMATION_PHRASE = 'DELETE PERMANENTLY';

/**
 * Permanently deletes the signed-in user's auth row, profile, posts, and related
 * data via `public.delete_account`. Requires the exact confirmation phrase.
 */
export async function requestAccountDeletionRpc(
  confirmation: string = DELETE_ACCOUNT_CONFIRMATION_PHRASE
): Promise<void> {
  const phrase = String(confirmation ?? '').trim();
  if (phrase !== DELETE_ACCOUNT_CONFIRMATION_PHRASE) {
    throw new Error('Account deletion requires typing DELETE PERMANENTLY');
  }
  const { error } = await supabase.rpc('delete_account', { confirmation: phrase });
  if (error) throw error;
}

export async function logOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Call after starter rankings are saved — unlocks main app (mirrors web). */
export async function markOnboardingComplete(): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    data: { onboarding_complete: true, find_people_seen: false },
  });
  if (error) throw error;
}

/** Call after the post-onboarding find-people screen — unlocks tabs. */
export async function markFindPeopleSeen(): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    data: { find_people_seen: true },
  });
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Drop cached sessions that fail `getUser()` — common after TestFlight updates or
 * expired refresh tokens. Without this the app can look "logged in" while every
 * API call (profiles, feed, login) fails.
 */
export async function resolveValidSession(
  session: Session | null
): Promise<Session | null> {
  if (!session) return null;
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    console.warn('resolveValidSession: clearing stale session', error?.message);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (signOutErr) {
      console.warn(
        'resolveValidSession signOut:',
        signOutErr instanceof Error ? signOutErr.message : signOutErr
      );
    }
    return null;
  }
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
    .select('id, username, avatar_color, bio')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return data as Profile;
}

const USERNAME_ALLOWED_RE = /[^a-z0-9_.]/g;

/** Resolve a display handle from auth session metadata (mirrors web App.jsx). */
export function usernameFromSession(session: Session | null): string | null {
  const meta = session?.user?.user_metadata;
  const fromMeta =
    meta && typeof meta === 'object' && 'username' in meta
      ? String((meta as { username?: unknown }).username ?? '')
          .trim()
          .toLowerCase()
          .replace(USERNAME_ALLOWED_RE, '')
      : '';
  if (fromMeta.length >= 3) return fromMeta;
  const emailLocal = String(session?.user?.email ?? '')
    .split('@')[0]
    ?.trim()
    .toLowerCase()
    .replace(USERNAME_ALLOWED_RE, '');
  return emailLocal.length >= 3 ? emailLocal : null;
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

/** True when onboarding is done but the user has not finished find-people yet. */
export function isFindPeoplePending(session: Session | null): boolean {
  if (isOnboardingIncomplete(session)) return false;
  const meta = session?.user?.user_metadata;
  if (!meta || typeof meta !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(meta, 'find_people_seen')) return false;
  return (meta as { find_people_seen?: unknown }).find_people_seen !== true;
}
