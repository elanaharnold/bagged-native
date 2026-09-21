import { Image, type ImageContentFit } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { FlatList } from 'react-native-gesture-handler';

import { ExpandedPhotoModal } from '@/components/bagged/expanded-photo-modal';
import { BaggedColors } from '@/constants/bagged-theme';
import { isPublicPostPhotoStorageUrl, normalizePhotoUrls } from '@/lib/data';

type PostPhotoStripProps = {
  urls?: string[] | null;
  maxHeight?: number;
  /** Optional — Supabase private buckets often need the user JWT on the image request. */
  imageHeaders?: Record<string, string>;
  /** Tap a photo to open full-screen viewer. Default true. */
  expandable?: boolean;
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

const MAX_RETRIES = 2;

function PhotoImage({
  uri,
  headers,
  style,
  contentFit = 'contain',
  onGiveUp,
}: {
  uri: string;
  headers?: Record<string, string>;
  style: object;
  contentFit?: ImageContentFit;
  onGiveUp: () => void;
}) {
  const [retries, setRetries] = useState(0);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setRetries(0);
    setFailed(false);
  }, [uri]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleError = useCallback(() => {
    if (retries < MAX_RETRIES) {
      timerRef.current = setTimeout(() => {
        setRetries((r) => r + 1);
      }, 800 * (retries + 1));
    } else {
      setFailed(true);
      onGiveUp();
    }
  }, [retries, onGiveUp]);

  if (failed) {
    return null;
  }

  const source = isPublicPostPhotoStorageUrl(uri)
    ? { uri: `${uri}${retries > 0 ? `#r=${retries}` : ''}` }
    : {
        uri: `${uri}${retries > 0 ? `#r=${retries}` : ''}`,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      };

  return (
    <Image
      key={`${uri}:${retries}`}
      source={source}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      onError={handleError}
    />
  );
}

export function PostPhotoStrip({
  urls,
  maxHeight = 200,
  imageHeaders,
  expandable = true,
}: PostPhotoStripProps) {
  const list = useMemo(() => httpImageUrls(urls), [urls]);
  const [failed, setFailed] = useState<Set<number>>(() => new Set());
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const tileSize = maxHeight;

  useEffect(() => {
    setFailed(new Set());
  }, [list.join('|')]);

  const markFailed = useCallback((index: number) => {
    setFailed((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  const visible = list.map((u, i) => ({ u, i })).filter(({ i }) => !failed.has(i));
  const visibleUrls = visible.map(({ u }) => u);

  const openExpanded = useCallback(
    (visibleIndex: number) => {
      if (!expandable || visibleIndex < 0) return;
      setExpandedIndex(visibleIndex);
    },
    [expandable]
  );

  if (list.length === 0 || visible.length === 0) return null;

  const modal = expandable ? (
    <ExpandedPhotoModal
      visible={expandedIndex != null}
      urls={visibleUrls}
      initialIndex={expandedIndex ?? 0}
      imageHeaders={imageHeaders}
      onClose={() => setExpandedIndex(null)}
    />
  ) : null;

  if (visible.length === 1) {
    const { u, i } = visible[0];
    return (
      <>
        <Pressable
          disabled={!expandable}
          onPress={() => openExpanded(0)}
          style={[styles.singleWrap, { width: tileSize, height: tileSize }]}>
          <PhotoImage
            uri={u}
            headers={imageHeaders}
            style={styles.singleImage}
            contentFit="cover"
            onGiveUp={() => markFailed(i)}
          />
        </Pressable>
        {modal}
      </>
    );
  }

  return (
    <>
      <FlatList
        horizontal
        data={visible}
        keyExtractor={({ u, i }) => `${i}:${u}`}
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        directionalLockEnabled
        keyboardShouldPersistTaps="handled"
        style={[styles.carousel, { height: tileSize }]}
        contentContainerStyle={styles.row}
        renderItem={({ item: { u, i }, index }) => (
          <Pressable
            disabled={!expandable}
            onPress={() => openExpanded(index)}
            style={[styles.thumb, { width: tileSize, height: tileSize }]}>
            <PhotoImage
              uri={u}
              headers={imageHeaders}
              style={styles.thumbImage}
              onGiveUp={() => markFailed(i)}
            />
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
      />
      {modal}
    </>
  );
}

const styles = StyleSheet.create({
  singleWrap: {
    alignSelf: 'center',
    marginBottom: 12,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: BaggedColors.white,
  },
  singleImage: {
    width: '100%',
    height: '100%',
  },
  carousel: {
    width: '100%',
    flexGrow: 0,
  },
  row: {
    paddingBottom: 12,
  },
  gap: {
    width: 8,
  },
  thumb: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BaggedColors.borderSoft,
    backgroundColor: BaggedColors.white,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
});
