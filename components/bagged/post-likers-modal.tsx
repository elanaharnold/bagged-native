import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Avatar } from '@/components/bagged/avatar';
import { UsernameLink } from '@/components/bagged/username-link';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { fetchPostLikers, type PostLikerRow } from '@/lib/data';

type PostLikersModalProps = {
  visible: boolean;
  postId: string | number | null;
  onClose: () => void;
  onPressUser: (username: string) => void;
};

export function PostLikersModal({
  visible,
  postId,
  onClose,
  onPressUser,
}: PostLikersModalProps) {
  const [rows, setRows] = useState<PostLikerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (postId == null) {
      setRows([]);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const likers = await fetchPostLikers(postId);
      setRows(likers);
    } catch (err) {
      console.warn('PostLikersModal load:', err);
      setRows([]);
      setErrorMsg('Could not load likes. Try again.');
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    if (!visible || postId == null) return;
    void load();
  }, [visible, postId, load]);

  const handlePressUser = (username: string) => {
    onClose();
    onPressUser(username);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <Text style={styles.title}>Likes</Text>
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={BaggedColors.dark} />
              </View>
            ) : errorMsg ? (
              <View style={styles.centered}>
                <Text style={styles.errorText}>{errorMsg}</Text>
                <Pressable onPress={() => void load()} style={styles.retryBtn}>
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </View>
            ) : rows.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>No likes yet.</Text>
              </View>
            ) : (
              <FlatList
                data={rows}
                keyExtractor={(item) => item.userId}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => handlePressUser(item.username)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                    <Avatar
                      char={(item.username || '?').charAt(0).toUpperCase()}
                      color={item.avatarColor ?? BaggedColors.accent}
                      size={40}
                    />
                    <UsernameLink username={item.username} style={styles.username} verified={item.isVerifiedAmbassador} />
                  </Pressable>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: BaggedColors.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '72%',
    minHeight: 220,
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 20,
    color: BaggedColors.onBg,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BaggedColors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 22,
    lineHeight: 24,
    color: BaggedColors.muted,
  },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { paddingVertical: 8, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  rowPressed: { opacity: 0.85 },
  username: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: BaggedColors.onBg,
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 36,
    gap: 10,
  },
  emptyText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBgMuted,
  },
  errorText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBgMuted,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: BaggedColors.borderOnBg,
  },
  retryText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.onBg,
  },
});
