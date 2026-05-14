import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AutoFitText } from '@/components/bagged/auto-fit-text';
import { Avatar } from '@/components/bagged/avatar';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { fetchCommentsForPost, postComment, type CommentRow } from '@/lib/data';
import { formatPostTime, formatProductDisplayName } from '@/lib/format';
import { useAuth } from '@/providers/auth-provider';

export default function CommentsModal() {
  const router = useRouter();
  const { userId } = useAuth();
  const { postId, postItem } = useLocalSearchParams<{ postId: string; postItem?: string }>();

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    setLoading(true);
    fetchCommentsForPost(postId)
      .then((rows) => {
        if (!cancelled) setComments(rows);
      })
      .catch((err) => {
        console.warn('fetchCommentsForPost:', err);
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : 'Could not load comments.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const submit = async () => {
    const content = text.trim();
    if (!content || !userId || !postId) return;
    setPosting(true);
    setErrorMsg(null);
    try {
      const row = await postComment({ userId, postId, content });
      setComments((prev) => [...prev, row]);
      setText('');
    } catch (err) {
      console.warn('postComment failed:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Could not post. Try again.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerLabels}>
          <Text style={styles.headerTitle}>Comments</Text>
          {postItem ? (
            <AutoFitText style={styles.headerSubtitle} numberOfLines={1}>
              {formatProductDisplayName(postItem)}
            </AutoFitText>
          ) : null}
        </View>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={BaggedColors.onBg} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <FlatList
          data={comments}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <CommentRowView row={item} onViewProfile={(u) => u && router.push({ pathname: '/user/[username]', params: { username: u } })} />}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            loading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={BaggedColors.onBg} />
              </View>
            ) : (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>No comments yet</Text>
                <Text style={styles.emptyBody}>Be the first to chime in.</Text>
              </View>
            )
          }
        />

        <View style={styles.composer}>
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
          <View style={styles.composerRow}>
            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder="Add a comment…"
              placeholderTextColor={BaggedColors.onBgMuted}
              multiline
              style={styles.composerInput}
            />
            <Pressable
              onPress={submit}
              disabled={posting || !text.trim() || !userId}
              hitSlop={6}
              style={[
                styles.sendBtn,
                (posting || !text.trim() || !userId) && styles.sendBtnDisabled,
              ]}>
              <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CommentRowView({
  row,
  onViewProfile,
}: {
  row: CommentRow;
  onViewProfile: (username: string | null | undefined) => void;
}) {
  const handle = row.profile?.username ?? 'unknown';
  const color = row.profile?.avatar_color ?? BaggedColors.accent;
  return (
    <View style={styles.commentRow}>
      <Pressable onPress={() => onViewProfile(handle)} hitSlop={4}>
        <Avatar char={handle.charAt(0).toUpperCase()} color={color} size={32} />
      </Pressable>
      <View style={styles.commentBody}>
        <View style={styles.commentHeader}>
          <Pressable onPress={() => onViewProfile(handle)} hitSlop={4}>
            <Text style={styles.commentHandle}>@{handle}</Text>
          </Pressable>
          <Text style={styles.commentTime}>{formatPostTime(row.created_at)}</Text>
        </View>
        <Text style={styles.commentText}>{row.content}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  headerLabels: { flex: 1, minWidth: 0 },
  headerTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.onBg,
  },
  headerSubtitle: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 6,
  },
  emptyTitle: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.onBg,
  },
  emptyBody: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.onBgMuted,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  commentBody: {
    flex: 1,
    minWidth: 0,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 3,
  },
  commentHandle: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    fontWeight: '700',
    color: BaggedColors.onBg,
  },
  commentTime: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.onBgMuted,
  },
  commentText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.onBg,
    lineHeight: 20,
  },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: BaggedColors.borderOnBg,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  composerInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: BaggedColors.card,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: BaggedColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  errorText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.accent,
    marginBottom: 6,
  },
});
