import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/bagged/avatar';
import { ExpandableMentionText } from '@/components/bagged/expandable-text';
import { UsernameLink } from '@/components/bagged/username-link';
import { CommentsPostSummary } from '@/components/bagged/comments-post-summary';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  canDeleteComment,
  deleteComment,
  fetchCommentsForPost,
  fetchFeedPostById,
  postComment,
  profileIsVerifiedAmbassador,
  threadedCommentRows,
  type CommentRow,
  type FeedPostRow,
} from '@/lib/data';
import { formatPostTime } from '@/lib/format';
import { patchFeedPost } from '@/lib/feed-refresh-poke';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useVerifiedAmbassadorUsernames } from '@/hooks/use-verified-ambassador-usernames';
import { useAuth } from '@/providers/auth-provider';

export default function CommentsModal() {
  const router = useRouter();
  const { userId, session } = useAuth();
  const {
    postId,
    replyToId,
    replyToUsername,
    highlightCommentId,
  } = useLocalSearchParams<{
    postId: string;
    postItem?: string;
    replyToId?: string;
    replyToUsername?: string;
    highlightCommentId?: string;
  }>();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const didScrollHighlightRef = useRef(false);

  const [post, setPost] = useState<FeedPostRow | null>(null);
  const [postLoading, setPostLoading] = useState(true);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; verified?: boolean } | null>(null);
  const [posting, setPosting] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const lastReplySeedKeyRef = useRef<string | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const globalVerifiedUsernames = useVerifiedAmbassadorUsernames();

  const storageImageHeaders = useMemo(
    () =>
      session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
    [session?.access_token]
  );

  const highlightId = String(highlightCommentId ?? '').trim();

  const replySeedKey = `${postId ?? ''}:${replyToId ?? ''}:${replyToUsername ?? ''}`;
  useEffect(() => {
    if (lastReplySeedKeyRef.current === replySeedKey) return;
    lastReplySeedKeyRef.current = replySeedKey;
    if (replyToId && replyToUsername) {
      const un = String(replyToUsername).replace(/^@/, '');
      setReplyTo({ id: String(replyToId), username: un });
      setText(`@${un} `);
    }
  }, [replySeedKey, replyToId, replyToUsername]);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    setPostLoading(true);
    fetchFeedPostById(postId)
      .then((row) => {
        if (!cancelled) setPost(row);
      })
      .catch((err) => {
        console.warn('fetchFeedPostById:', err);
        if (!cancelled) setPost(null);
      })
      .finally(() => {
        if (!cancelled) setPostLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

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

  const threaded = useMemo(() => threadedCommentRows(comments), [comments]);

  const verifiedUsernames = useMemo(() => {
    const set = new Set(globalVerifiedUsernames);
    for (const comment of comments) {
      const handle = String(comment.profile?.username ?? '')
        .trim()
        .toLowerCase();
      if (handle && profileIsVerifiedAmbassador(comment.profile)) {
        set.add(handle);
      }
    }
    const postHandle = String(post?.profile?.username ?? '')
      .trim()
      .toLowerCase();
    if (postHandle && profileIsVerifiedAmbassador(post?.profile)) {
      set.add(postHandle);
    }
    return set;
  }, [comments, post, globalVerifiedUsernames]);

  useEffect(() => {
    if (!highlightId || loading || didScrollHighlightRef.current || threaded.length === 0) return;
    const idx = threaded.findIndex((t) => String(t.node.id) === highlightId);
    if (idx < 0) return;
    didScrollHighlightRef.current = true;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.35 });
    }, 120);
    return () => clearTimeout(timer);
  }, [highlightId, loading, threaded]);

  const startReply = (row: CommentRow) => {
    const un = String(row.profile?.username || 'unknown').replace(/^@/, '');
    setReplyTo({
      id: row.id,
      username: un,
      verified: profileIsVerifiedAmbassador(row.profile),
    });
    setText(`@${un} `);
  };

  const cancelReply = () => {
    setReplyTo(null);
    setText((prev) => prev.replace(/^@\S+\s*/, '').trimStart());
  };

  const handleDeleteComment = (row: CommentRow) => {
    if (!userId || !postId || deletingCommentId) return;
    const isOwnComment = String(row.user_id) === String(userId);
    Alert.alert(
      'Delete comment?',
      isOwnComment
        ? 'Remove this comment? Replies will be deleted too.'
        : 'Remove this comment from your post? Replies will be deleted too.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingCommentId(String(row.id));
              setErrorMsg(null);
              try {
                const { deletedIds } = await deleteComment({
                  userId,
                  commentId: String(row.id),
                  postId,
                });
                const removed = new Set(deletedIds.map(String));
                setComments((prev) => prev.filter((c) => !removed.has(String(c.id))));
                if (replyTo && removed.has(String(replyTo.id))) {
                  setReplyTo(null);
                  setText('');
                }
                patchFeedPost({ postId, commentsDelta: -deletedIds.length });
              } catch (err) {
                console.warn('deleteComment failed:', err);
                setErrorMsg(err instanceof Error ? err.message : 'Could not delete comment.');
              } finally {
                setDeletingCommentId(null);
              }
            })();
          },
        },
      ]
    );
  };

  const submit = async () => {
    const content = text.trim();
    if (!content || !userId || !postId) return;
    setPosting(true);
    setErrorMsg(null);
    try {
      const row = await postComment({
        userId,
        postId,
        content,
        parentCommentId: replyTo?.id,
      });
      setComments((prev) => [...prev, row]);
      setText('');
      setReplyTo(null);
      patchFeedPost({ postId, commentsDelta: 1 });
    } catch (err) {
      console.warn('postComment failed:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Could not post. Try again.');
    } finally {
      setPosting(false);
    }
  };

  const listHeader = (
    <View style={styles.listHeader}>
      {postLoading ? (
        <View style={styles.postLoading}>
          <ActivityIndicator color={BaggedColors.onBg} />
        </View>
      ) : post ? (
        <CommentsPostSummary
          post={post}
          imageHeaders={storageImageHeaders}
          onPressUser={(u) => router.push({ pathname: '/user/[username]', params: { username: u } })}
        />
      ) : (
        <View style={styles.postMissing}>
          <Text style={styles.postMissingText}>Could not load this post.</Text>
        </View>
      )}
      <Text style={styles.threadLabel}>Comments</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingBottom: keyboardHeight }]}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Comments</Text>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={BaggedColors.onBg} />
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={threaded}
          keyExtractor={(item) => item.node.id}
          ListHeaderComponent={listHeader}
          renderItem={({ item }) => (
            <CommentRowView
              row={item.node}
              depth={item.depth}
              highlighted={highlightId.length > 0 && String(item.node.id) === highlightId}
              canReply={!!userId}
              canDelete={
                !!userId &&
                !!post &&
                canDeleteComment({
                  viewerUserId: userId,
                  commentAuthorUserId: String(item.node.user_id),
                  postAuthorUserId: post.user_id,
                })
              }
              deleting={deletingCommentId === String(item.node.id)}
              verifiedUsernames={verifiedUsernames}
              onReply={() => startReply(item.node)}
              onDelete={() => handleDeleteComment(item.node)}
              onViewProfile={(u) => u && router.push({ pathname: '/user/[username]', params: { username: u } })}
            />
          )}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: Math.max(0, info.averageItemLength * info.index),
              animated: true,
            });
          }}
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

        <View
          style={[
            styles.composer,
            {
              paddingBottom: keyboardHeight > 0 ? 8 : Math.max(insets.bottom, 12),
            },
          ]}>
          {replyTo ? (
            <View style={styles.replyBanner}>
              <Text style={styles.replyBannerText}>
                Replying to{' '}
                <UsernameLink
                  username={replyTo.username}
                  style={styles.replyBannerHandle}
                  verified={replyTo.verified}
                />
              </Text>
              <Pressable onPress={cancelReply} hitSlop={8}>
                <Text style={styles.replyCancel}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
          <View style={styles.composerRow}>
            <TextInput
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (errorMsg) setErrorMsg(null);
              }}
              placeholder={replyTo ? `Reply to @${replyTo.username}…` : 'Add a comment…'}
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
              <Ionicons name="arrow-up" size={18} color={BaggedColors.green} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function CommentRowView({
  row,
  depth,
  highlighted,
  canReply,
  canDelete,
  deleting,
  verifiedUsernames,
  onReply,
  onDelete,
  onViewProfile,
}: {
  row: CommentRow;
  depth: number;
  highlighted?: boolean;
  canReply: boolean;
  canDelete: boolean;
  deleting?: boolean;
  verifiedUsernames: ReadonlySet<string>;
  onReply: () => void;
  onDelete: () => void;
  onViewProfile: (username: string | null | undefined) => void;
}) {
  const handle = row.profile?.username ?? 'unknown';
  const color = row.profile?.avatar_color ?? BaggedColors.accent;
  return (
    <View
      style={[
        styles.commentRow,
        { marginLeft: depth * 16 },
        highlighted ? styles.commentRowHighlighted : null,
      ]}>
      <Pressable onPress={() => onViewProfile(handle)} hitSlop={4}>
        <Avatar char={handle.charAt(0).toUpperCase()} color={color} size={32} />
      </Pressable>
      <View style={styles.commentBody}>
        <View style={styles.commentHeader}>
          <UsernameLink
            username={handle}
            style={styles.commentHandle}
            verified={profileIsVerifiedAmbassador(row.profile)}
          />
          <Text style={styles.commentTime}>{formatPostTime(row.created_at)}</Text>
        </View>
        <ExpandableMentionText
          text={row.content ?? ''}
          style={styles.commentText}
          mentionStyle={styles.commentHandle}
          verifiedUsernames={verifiedUsernames}
        />
        {canReply || canDelete ? (
          <View style={styles.commentActions}>
            {canReply ? (
              <Pressable onPress={onReply} hitSlop={6} style={styles.replyBtn}>
                <Text style={styles.replyBtnText}>Reply</Text>
              </Pressable>
            ) : null}
            {canDelete ? (
              <Pressable
                onPress={onDelete}
                disabled={deleting}
                hitSlop={6}
                style={styles.deleteBtn}
                accessibilityRole="button"
                accessibilityLabel="Delete comment">
                <Text style={[styles.deleteBtnText, deleting && styles.deleteBtnTextDisabled]}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
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
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderOnBg,
  },
  headerTitle: {
    flex: 1,
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.onBg,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    flexGrow: 1,
  },
  listHeader: {
    marginBottom: 8,
  },
  postLoading: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  postMissing: {
    backgroundColor: BaggedColors.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  postMissingText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    textAlign: 'center',
  },
  threadLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.onBgMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 12,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
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
    borderRadius: 10,
    padding: 6,
    marginHorizontal: -6,
  },
  commentRowHighlighted: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
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
  replyBtn: {
    alignSelf: 'flex-start',
  },
  replyBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.accent,
  },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  deleteBtn: {
    alignSelf: 'flex-start',
  },
  deleteBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.onBgMuted,
  },
  deleteBtnTextDisabled: {
    opacity: 0.5,
  },
  composer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BaggedColors.borderOnBg,
    backgroundColor: BaggedColors.bg,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 10,
  },
  replyBannerText: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.onBgMuted,
  },
  replyBannerHandle: {
    fontWeight: '700',
    color: BaggedColors.onBg,
  },
  replyCancel: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.accent,
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
