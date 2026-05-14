import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY_FEED_DIET = 'bagged_show_feed_diet_bar';
const KEY_MACROS = 'bagged_show_macro_nutrition';

type DisplaySettingsContextValue = {
  ready: boolean;
  showFeedDietBar: boolean;
  showMacroNutrition: boolean;
  setShowFeedDietBar: (v: boolean) => void;
  setShowMacroNutrition: (v: boolean) => void;
};

const DisplaySettingsContext = createContext<DisplaySettingsContextValue | null>(null);

export function DisplaySettingsProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [showFeedDietBar, setShowFeedDietBarState] = useState(false);
  const [showMacroNutrition, setShowMacroNutritionState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [d, m] = await Promise.all([AsyncStorage.getItem(KEY_FEED_DIET), AsyncStorage.getItem(KEY_MACROS)]);
        if (cancelled) return;
        if (d != null) setShowFeedDietBarState(d === 'true');
        if (m != null) setShowMacroNutritionState(m === 'true');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setShowFeedDietBar = useCallback((v: boolean) => {
    setShowFeedDietBarState(v);
    AsyncStorage.setItem(KEY_FEED_DIET, v ? 'true' : 'false').catch(() => {});
  }, []);

  const setShowMacroNutrition = useCallback((v: boolean) => {
    setShowMacroNutritionState(v);
    AsyncStorage.setItem(KEY_MACROS, v ? 'true' : 'false').catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      ready,
      showFeedDietBar,
      showMacroNutrition,
      setShowFeedDietBar,
      setShowMacroNutrition,
    }),
    [ready, showFeedDietBar, showMacroNutrition, setShowFeedDietBar, setShowMacroNutrition]
  );

  return <DisplaySettingsContext.Provider value={value}>{children}</DisplaySettingsContext.Provider>;
}

export function useDisplaySettings(): DisplaySettingsContextValue {
  const ctx = useContext(DisplaySettingsContext);
  if (!ctx) {
    throw new Error('useDisplaySettings must be used within DisplaySettingsProvider');
  }
  return ctx;
}
