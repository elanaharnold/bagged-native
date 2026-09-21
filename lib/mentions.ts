/** Matches a completed @handle token in note/comment text. */
export const MENTION_TOKEN_RE = /@[a-zA-Z0-9_.]+/g;

/** Split text into plain spans and @mention spans (capture group keeps delimiters). */
export const MENTION_SPLIT_RE = /(@[a-zA-Z0-9_.]+)/g;

export type ActiveMentionQuery = {
  /** Index of the `@` character. */
  start: number;
  /** Partial handle typed after `@` (may be empty). */
  query: string;
};

/** Returns the in-progress @mention at the cursor, if any. */
export function getActiveMentionQuery(text: string, cursor: number): ActiveMentionQuery | null {
  const before = String(text ?? '').slice(0, Math.max(0, cursor));
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && /[a-zA-Z0-9]/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;
  if (!/^[a-zA-Z0-9_.]*$/.test(query)) return null;
  return { start: at, query };
}

export function extractMentionUsernames(text: string): string[] {
  const seen = new Set<string>();
  for (const match of String(text ?? '').matchAll(MENTION_TOKEN_RE)) {
    const handle = match[0].slice(1).trim().toLowerCase();
    if (handle) seen.add(handle);
  }
  return [...seen];
}

/** Replace the active @query (or insert at cursor) with a full `@username ` token. */
export function applyMentionSelection(
  text: string,
  cursor: number,
  username: string
): { text: string; cursor: number } {
  const handle = String(username ?? '').trim().replace(/^@/, '');
  const insert = `@${handle} `;
  const active = getActiveMentionQuery(text, cursor);
  if (!active) {
    const next = `${text.slice(0, cursor)}${insert}${text.slice(cursor)}`;
    return { text: next, cursor: cursor + insert.length };
  }
  const next = `${text.slice(0, active.start)}${insert}${text.slice(cursor)}`;
  return { text: next, cursor: active.start + insert.length };
}
