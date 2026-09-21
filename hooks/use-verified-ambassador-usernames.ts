import { useEffect, useState } from 'react';

import { fetchVerifiedAmbassadorUsernames } from '@/lib/data';

export function useVerifiedAmbassadorUsernames(): ReadonlySet<string> {
  const [verifiedUsernames, setVerifiedUsernames] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetchVerifiedAmbassadorUsernames()
      .then((set) => {
        if (!cancelled) setVerifiedUsernames(set);
      })
      .catch(() => {
        if (!cancelled) setVerifiedUsernames(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return verifiedUsernames;
}
