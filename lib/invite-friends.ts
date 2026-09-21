import { Share } from 'react-native';

const INVITE_MESSAGE =
  "I'm ranking groceries on Bagged — join me and share what you're loving at the store.\n\nhttps://apps.apple.com/us/app/bagged/id6769496569";

/** Opens the system share sheet with a Bagged invite message. */
export async function inviteFriendsToBagged(): Promise<void> {
  try {
    await Share.share({ message: INVITE_MESSAGE });
  } catch {
    // User dismissed or share unavailable — no-op.
  }
}
