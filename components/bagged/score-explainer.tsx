import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

const SEEN_KEY = 'bagged_score_explainer_seen_v1';

/**
 * Explains how a Bagged score is calculated. Opens on its own the first time a
 * user sees a score; after that it's a "How is this calculated?" link.
 * Numbers match lib/ranking.ts (SINGLETON_RATING_BY_VIBE, VIBE_CEILING).
 */
export function ScoreExplainer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_KEY);
        if (!seen && !cancelled) {
          setOpen(true);
          await AsyncStorage.setItem(SEEN_KEY, '1');
        }
      } catch {
        /* storage unavailable: leave collapsed */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={styles.linkWrap}>
        <Text style={styles.link}>How is this calculated?</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>How your score works</Text>
      <Text style={styles.line}>
        <Text style={styles.bold}>It&apos;s based on your list. </Text>
        Your score comes from where this lands among everything you&apos;ve ranked in this
        category. Your favorite sits near 10, your least favorite near 0.
      </Text>
      <Text style={styles.line}>
        <Text style={styles.bold}>How you felt sets the range. </Text>
        I loved it: up to 10. It was fine: up to 7.5. Didn&apos;t like it: up to 4.
      </Text>
      <Text style={styles.line}>
        <Text style={styles.bold}>It moves as you rank more. </Text>
        Your first item in a category starts at 9, 6 or 3. As you add more, scores shift so
        your list stays in order.
      </Text>
      <Pressable onPress={() => setOpen(false)} hitSlop={8} style={styles.linkWrap}>
        <Text style={styles.link}>Got it</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 4,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: BaggedColors.accentPale,
    gap: 8,
  },
  title: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: BaggedColors.ink,
  },
  line: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: BaggedColors.ink,
  },
  bold: {
    fontWeight: '700',
  },
  linkWrap: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  link: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: BaggedColors.accent,
    textDecorationLine: 'underline',
  },
});
