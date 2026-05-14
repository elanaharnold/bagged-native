import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BaggedColors } from '@/constants/bagged-theme';
import { normalizePhotoUrls } from '@/lib/data';

type PostPhotoStripProps = {
  urls?: string[] | null;
  maxHeight?: number;
  /** Optional — Supabase private buckets often need the user JWT on the image request. */
  imageHeaders?: Record<string, string>;
};

function httpImageUrls(raw: unknown): string[] {
  return normalizePhotoUrls(raw).filter((u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'https:' || x.protocol === 'http:';
    } catch {
      return false;
    }
  });
}

export function PostPhotoStrip({ urls, maxHeight = 200, imageHeaders }: PostPhotoStripProps) {
  const list = useMemo(() => httpImageUrls(urls), [urls]);
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    setHidden(new Set());
  }, [list.join('|')]);

  if (list.length === 0) return null;

  const src = (uri: string) =>
    imageHeaders && Object.keys(imageHeaders).length > 0 ? { uri, headers: imageHeaders } : { uri };

  if (list.length === 1) {
    if (hidden.has(0)) return null;
    return (
      <View style={[styles.singleWrap, { height: maxHeight }]}>
        <Image
          source={src(list[0])}
          style={styles.singleImage}
          contentFit="cover"
          onError={() => setHidden((s) => new Set(s).add(0))}
        />
      </View>
    );
  }

  const visible = list.map((u, i) => ({ u, i })).filter(({ i }) => !hidden.has(i));
  if (visible.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      {visible.map(({ u, i }) => (
        <View key={`${i}:${u}`} style={[styles.thumb, { height: maxHeight }]}>
          <Image
            source={src(u)}
            style={styles.thumbImage}
            contentFit="cover"
            onError={() => setHidden((s) => new Set(s).add(i))}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  singleWrap: {
    marginBottom: 12,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BaggedColors.borderSoft,
    backgroundColor: BaggedColors.card,
  },
  singleImage: {
    width: '100%',
    height: '100%',
  },
  row: {
    gap: 8,
    paddingBottom: 12,
  },
  thumb: {
    width: 220,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BaggedColors.borderSoft,
    backgroundColor: BaggedColors.card,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
});
