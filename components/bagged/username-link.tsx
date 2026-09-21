import { useRouter } from 'expo-router';
import { StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { VerifiedAmbassadorCheck } from '@/components/bagged/verified-ambassador-badge';
import { MENTION_SPLIT_RE } from '@/lib/mentions';

export function normalizeUsernameHandle(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .replace(/^@/, '');
}

export function isNavigableUsername(raw: string | null | undefined): boolean {
  const handle = normalizeUsernameHandle(raw);
  return handle.length > 0 && handle.toLowerCase() !== 'unknown';
}

type UsernameLinkProps = {
  username: string | null | undefined;
  style?: StyleProp<TextStyle>;
  /** Render as plain text — e.g. the profile header for the user you're already viewing. */
  static?: boolean;
  verified?: boolean;
};

/** Tappable @username — opens `/user/[username]`. */
export function UsernameLink({ username, style, static: isStatic, verified = false }: UsernameLinkProps) {
  const router = useRouter();
  const handle = normalizeUsernameHandle(username);
  const label = `@${handle || 'unknown'}`;

  const link =
    isStatic || !isNavigableUsername(handle) ? (
      <Text style={style}>{label}</Text>
    ) : (
      <Text
        style={style}
        onPress={() =>
          router.push({ pathname: '/user/[username]', params: { username: handle } })
        }>
        {label}
      </Text>
    );

  if (!verified) return link;

  return (
    <View style={styles.inlineRow}>
      {link}
      <VerifiedAmbassadorCheck compact />
    </View>
  );
}

type MentionTextProps = {
  text: string;
  style?: StyleProp<TextStyle>;
  mentionStyle?: StyleProp<TextStyle>;
  numberOfLines?: TextProps['numberOfLines'];
  quoted?: boolean;
  verifiedUsernames?: ReadonlySet<string>;
};

/** Renders note/comment text with tappable @username segments. */
export function MentionText({
  text,
  style,
  mentionStyle,
  numberOfLines,
  quoted = false,
  verifiedUsernames,
}: MentionTextProps) {
  const router = useRouter();
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(MENTION_SPLIT_RE);

  if (parts.length <= 1) {
    const display = quoted ? `\u201C${raw}\u201D` : raw;
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {display}
      </Text>
    );
  }

  const hasVerifiedMention = parts.some((part) => {
    if (!part.startsWith('@') || part.length <= 1) return false;
    const handle = normalizeUsernameHandle(part);
    return Boolean(verifiedUsernames?.has(handle.toLowerCase()));
  });

  if (!hasVerifiedMention) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {quoted ? '\u201C' : null}
        {parts.map((part, index) => {
          if (!part.startsWith('@') || part.length <= 1) {
            return <Text key={index}>{part}</Text>;
          }
          const handle = normalizeUsernameHandle(part);
          if (!isNavigableUsername(handle)) {
            return <Text key={index}>{part}</Text>;
          }
          return (
            <Text
              key={index}
              style={mentionStyle ?? style}
              onPress={() =>
                router.push({ pathname: '/user/[username]', params: { username: handle } })
              }>
              @{handle}
            </Text>
          );
        })}
        {quoted ? '\u201D' : null}
      </Text>
    );
  }

  return (
    <View style={styles.mentionWrap}>
      {quoted ? <Text style={style}>{'\u201C'}</Text> : null}
      {parts.map((part, index) => {
        if (!part.startsWith('@') || part.length <= 1) {
          return (
            <Text key={index} style={style}>
              {part}
            </Text>
          );
        }
        const handle = normalizeUsernameHandle(part);
        if (!isNavigableUsername(handle)) {
          return (
            <Text key={index} style={style}>
              {part}
            </Text>
          );
        }
        const verified = Boolean(verifiedUsernames?.has(handle.toLowerCase()));
        return (
          <View key={index} style={styles.inlineRow}>
            <Text
              style={mentionStyle ?? style}
              onPress={() =>
                router.push({ pathname: '/user/[username]', params: { username: handle } })
              }>
              @{handle}
            </Text>
            {verified ? <VerifiedAmbassadorCheck compact /> : null}
          </View>
        );
      })}
      {quoted ? <Text style={style}>{'\u201D'}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  mentionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 2,
  },
});
