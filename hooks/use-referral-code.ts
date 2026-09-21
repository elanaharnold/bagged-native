// Reads the current user's referral code from Supabase.
// The code itself is NEVER generated on the client — it's assigned server-side
// by the `set_referral_code()` trigger the moment the profiles row is created.

import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

type ReferralState = {
  code: string | null;
  loading: boolean;
  refetch: () => Promise<void>;
};

export function useReferralCode(): ReferralState {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCode = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setCode(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', user.id)
      .single();

    if (!error && data) {
      setCode(data.referral_code);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchCode();
  }, [fetchCode]);

  return { code, loading, refetch: fetchCode };
}

/** Call from onboarding or settings when the user submits a referral code. */
export async function redeemReferralCode(rawCode: string) {
  const { data, error } = await supabase.rpc('redeem_referral_code', {
    p_code: rawCode.trim().toUpperCase(),
  });

  if (error) {
    return { success: false, error: error.message } as const;
  }

  return data as { success: boolean; error?: string };
}
