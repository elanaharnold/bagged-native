import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BaggedColors } from '@/constants/bagged-theme';
import { isPublicPostPhotoStorageUrl } from '@/lib/data';

type ExpandedPhotoModalProps = {
  visible: boolean;
  urls: string[];
  initialIndex?: number;
  imageHeaders?: Record<string, string>;
  onClose: () => void;
};

function ExpandedPhoto({
  uri,
  headers,
  width,
  height,
}: {
  uri: string;
  headers?: Record<string, string>;
  width: number;
  height: number;
}) {
  const source = isPublicPostPhotoStorageUrl(uri)
    ? { uri }
    : {
        uri,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      };

  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={source}
        style={{ width, height }}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    </View>
  );
}

export function ExpandedPhotoModal({
  visible,
  urls,
  initialIndex = 0,
  imageHeaders,
  onClose,
}: ExpandedPhotoModalProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<string>>(null);
  const [index, setIndex] = useState(initialIndex);

  useEffect(() => {
    if (!visible) return;
    const safeIndex = Math.min(Math.max(initialIndex, 0), Math.max(urls.length - 1, 0));
    setIndex(safeIndex);
    requestAnimationFrame(() => {
      if (urls.length > 0) {
        listRef.current?.scrollToIndex({ index: safeIndex, animated: false });
      }
    });
  }, [visible, initialIndex, urls.length]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: { index: number | null }[] }) => {
      const next = viewableItems[0]?.index;
      if (next != null) setIndex(next);
    },
    []
  );

  if (urls.length === 0) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <FlatList
          ref={listRef}
          data={urls}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(uri, i) => `${i}:${uri}`}
          initialScrollIndex={Math.min(initialIndex, urls.length - 1)}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          renderItem={({ item }) => (
            <ExpandedPhoto uri={item} headers={imageHeaders} width={width} height={height} />
          )}
        />

        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={[styles.closeBtn, { top: insets.top + 8 }]}>
          <Ionicons name="close" size={28} color={BaggedColors.white} />
        </Pressable>

        {urls.length > 1 ? (
          <View style={[styles.counter, { bottom: insets.bottom + 16 }]}>
            <Text style={styles.counterText} allowFontScaling={false}>
              {index + 1} / {urls.length}
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
  },
  closeBtn: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  counterText: {
    color: BaggedColors.white,
    fontSize: 13,
    fontWeight: '600',
  },
});
