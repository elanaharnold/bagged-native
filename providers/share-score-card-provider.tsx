import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { ShareCategoryListModal } from '@/components/bagged/share-category-list-modal';
import { ShareScoreCardModal } from '@/components/bagged/share-score-card-modal';
import { ShareScoreCardErrorBoundary } from '@/components/bagged/share-score-card-error-boundary';
import type { CategoryListShareableData } from '@/lib/share-category-list';
import type { ShareableData } from '@/lib/share-score-card';

type ShareModalState =
  | { mode: 'post'; data: ShareableData }
  | { mode: 'category'; data: CategoryListShareableData }
  | null;

type ShareScoreCardContextValue = {
  openShareScoreCard: (data: ShareableData) => void;
  openCategoryListShareable: (data: CategoryListShareableData) => void;
};

const ShareScoreCardContext = createContext<ShareScoreCardContextValue | null>(null);

export function ShareScoreCardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShareModalState>(null);

  const openShareScoreCard = useCallback((next: ShareableData) => {
    setState({ mode: 'post', data: next });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const openCategoryListShareable = useCallback((next: CategoryListShareableData) => {
    setState({ mode: 'category', data: next });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, []);

  const close = useCallback(() => {
    setState(null);
  }, []);

  const value = useMemo(
    () => ({ openShareScoreCard, openCategoryListShareable }),
    [openShareScoreCard, openCategoryListShareable]
  );

  const boundaryKey = state ? `${state.mode}-${state.mode === 'post' ? state.data.item : state.data.category}` : 'closed';

  return (
    <ShareScoreCardContext.Provider value={value}>
      {children}
      <ShareScoreCardErrorBoundary key={boundaryKey} onClose={close}>
        {state?.mode === 'post' ? (
          <ShareScoreCardModal visible data={state.data} onClose={close} />
        ) : state?.mode === 'category' ? (
          <ShareCategoryListModal visible data={state.data} onClose={close} />
        ) : null}
      </ShareScoreCardErrorBoundary>
    </ShareScoreCardContext.Provider>
  );
}

export function useShareScoreCard() {
  const ctx = useContext(ShareScoreCardContext);
  if (!ctx) {
    throw new Error('useShareScoreCard must be used within ShareScoreCardProvider');
  }
  return ctx;
}
