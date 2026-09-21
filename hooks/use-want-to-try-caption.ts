import { useCallback, useState } from 'react';

import { formatProductDisplayName } from '@/lib/format';
import { postWantToTryWithFeed } from '@/lib/want-to-try-feed';
import type { WantToTrySource } from '@/lib/want-to-try-source';

export type WantToTryCaptionTarget = {
  item: string;
  brand?: string;
  descriptionKey?: string;
  stores?: string[];
  category?: string;
  subcategory?: string;
  dietTags?: string[];
  source: WantToTrySource;
};

export function wantToTryCaptionProductLabel(target: WantToTryCaptionTarget): string {
  return formatProductDisplayName(target.item);
}

/** Opens a caption step before creating a want-to-try feed post. */
export function useWantToTryCaption(userId: string | null | undefined) {
  const [captionTarget, setCaptionTarget] = useState<WantToTryCaptionTarget | null>(null);
  const [captionSaving, setCaptionSaving] = useState(false);

  const requestWantToTryCaption = useCallback((target: WantToTryCaptionTarget) => {
    setCaptionTarget(target);
  }, []);

  const cancelWantToTryCaption = useCallback(() => {
    if (captionSaving) return;
    setCaptionTarget(null);
  }, [captionSaving]);

  const confirmWantToTryCaption = useCallback(
    async (note: string): Promise<string | null> => {
      if (!userId || !captionTarget) return null;
      setCaptionSaving(true);
      try {
        const { radarPostId } = await postWantToTryWithFeed({
          userId,
          item: captionTarget.item,
          brand: captionTarget.brand,
          descriptionKey: captionTarget.descriptionKey,
          stores: captionTarget.stores,
          category: captionTarget.category,
          subcategory: captionTarget.subcategory,
          dietTags: captionTarget.dietTags,
          source: captionTarget.source,
          note,
        });
        setCaptionTarget(null);
        return radarPostId;
      } finally {
        setCaptionSaving(false);
      }
    },
    [userId, captionTarget]
  );

  return {
    captionTarget,
    captionSaving,
    requestWantToTryCaption,
    cancelWantToTryCaption,
    confirmWantToTryCaption,
  };
}
