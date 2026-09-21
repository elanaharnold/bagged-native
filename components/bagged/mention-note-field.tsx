import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextInputProps,
} from 'react-native';

import { Avatar } from '@/components/bagged/avatar';
import { UsernameLink } from '@/components/bagged/username-link';
import { TextField, type TextFieldVariant } from '@/components/bagged/text-field';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import {
  fetchFollowingForProfileUserId,
  type FindPeopleProfileRow,
} from '@/lib/data';
import { applyMentionSelection, getActiveMentionQuery } from '@/lib/mentions';

type MentionNoteFieldProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'style'> & {
  value: string;
  onChangeText: (text: string) => void;
  userId?: string | null;
  variant?: TextFieldVariant;
  inputStyle?: TextInputProps['style'];
};

export function MentionNoteField({
  value,
  onChangeText,
  userId,
  variant = 'light',
  inputStyle,
  onSelectionChange,
  ...rest
}: MentionNoteFieldProps) {
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(
    null
  );
  const [suggestions, setSuggestions] = useState<FindPeopleProfileRow[]>([]);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [following, setFollowing] = useState<{ username: string; avatarColor: string | null }[]>(
    []
  );

  const activeMention = useMemo(
    () => getActiveMentionQuery(value, selection.end),
    [value, selection.end]
  );

  const handleChangeText = useCallback(
    (text: string) => {
      const delta = text.length - value.length;
      onChangeText(text);
      if (delta !== 0) {
        setSelection((sel) => {
          const nextEnd = Math.max(0, Math.min(sel.end + delta, text.length));
          return { start: nextEnd, end: nextEnd };
        });
      }
    },
    [onChangeText, value.length]
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setFollowingLoading(true);
    void fetchFollowingForProfileUserId(userId)
      .then((rows) => {
        if (cancelled) return;
        setFollowing(
          rows.map((r) => ({
            username: r.username,
            avatarColor: r.avatarColor,
          }))
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFollowingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!activeMention || !userId) {
      setSuggestions([]);
      return;
    }

    const q = activeMention.query.trim().toLowerCase();
    const fromFollowing = following
      .filter((row) => row.username)
      .filter((row) => !q || row.username.toLowerCase().startsWith(q))
      .slice(0, 8)
      .map(
        (row): FindPeopleProfileRow => ({
          id: row.username,
          username: row.username,
          bio: null,
          avatarColor: row.avatarColor,
          dietTags: [],
          isVerifiedAmbassador: false,
        })
      );

    setSuggestions(fromFollowing);
  }, [activeMention, following, userId]);

  const pickMention = useCallback(
    (username: string) => {
      const { text: next, cursor } = applyMentionSelection(value, selection.end, username);
      onChangeText(next);
      setPendingSelection({ start: cursor, end: cursor });
      setSuggestions([]);
    },
    [onChangeText, selection.end, value]
  );

  const showSuggestions = Boolean(
    activeMention && userId && (followingLoading || suggestions.length > 0)
  );

  return (
    <View style={styles.wrap}>
      <TextField
        {...rest}
        variant={variant}
        value={value}
        onChangeText={handleChangeText}
        inputStyle={inputStyle}
        selection={pendingSelection ?? undefined}
        onSelectionChange={(e) => {
          const next = e.nativeEvent.selection;
          setSelection(next);
          if (pendingSelection) setPendingSelection(null);
          onSelectionChange?.(e);
        }}
      />
      {showSuggestions ? (
        <View style={styles.suggestions}>
          {followingLoading && suggestions.length === 0 ? (
            <View style={styles.suggestionLoading}>
              <ActivityIndicator size="small" color={BaggedColors.muted} />
            </View>
          ) : (
            suggestions.map((row) => (
              <Pressable
                key={row.id}
                onPress={() => pickMention(row.username)}
                style={({ pressed }) => [styles.suggestionRow, pressed && styles.pressed]}>
                <Avatar
                  char={row.username.charAt(0).toUpperCase()}
                  color={row.avatarColor ?? BaggedColors.accent}
                  size={28}
                />
                <UsernameLink
                  username={row.username}
                  style={styles.suggestionHandle}
                  static
                  verified={row.isVerifiedAmbassador}
                />
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  suggestions: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderSoft,
    backgroundColor: BaggedColors.white,
    overflow: 'hidden',
  },
  suggestionLoading: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.borderSoft,
  },
  suggestionHandle: {
    flex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
  pressed: {
    opacity: 0.85,
  },
});
