import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  DELETE_ACCOUNT_CONFIRMATION_PHRASE,
  DeleteAccountConfirmationModal,
} from '@/components/bagged/delete-account-confirmation-modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardFormScroll } from '@/components/bagged/keyboard-form-scroll';
import { TextField } from '@/components/bagged/text-field';
import { AVATAR_COLORS } from '@/constants/avatar-colors';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { fetchDuplicateCandidates, isBothRated } from '@/lib/admin-duplicates';
import { requestAccountDeletionRpc, updatePassword } from '@/lib/auth';
import {
  fetchProfileById,
  isAdminUsername,
  isUsernameAvailable,
  updateOwnProfile,
  type ProfileRow,
} from '@/lib/data';
import { useAuth } from '@/providers/auth-provider';
import { useDisplaySettings } from '@/providers/display-settings-provider';

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId, signOut, username: authUsername } = useAuth();
  const isAdmin = isAdminUsername(authUsername);
  const [duplicateCount, setDuplicateCount] = useState<{ both: number; total: number } | null>(null);
  const { showFeedDietBar, showMacroNutrition, setShowFeedDietBar, setShowMacroNutrition } =
    useDisplaySettings();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarColor, setAvatarColor] = useState<string>(BaggedColors.accent);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);
  const [passwordErr, setPasswordErr] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let cancelled = false;
      setLoading(true);
      fetchProfileById(userId)
        .then((p) => {
          if (cancelled) return;
          setProfile(p);
          setUsername(p?.username ?? '');
          setBio(p?.bio ?? '');
          setAvatarColor(p?.avatar_color ?? BaggedColors.accent);
        })
        .catch((err) => console.warn('settings load:', err))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [userId])
  );

  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) return;
      let cancelled = false;
      fetchDuplicateCandidates()
        .then((rows) => {
          if (!cancelled) {
            setDuplicateCount({
              both: rows.filter((r) => r.reported || isBothRated(r)).length,
              total: rows.length,
            });
          }
        })
        .catch(() => {
          if (!cancelled) setDuplicateCount(null);
        });
      return () => {
        cancelled = true;
      };
    }, [isAdmin])
  );

  const dirty = profile
    ? username.trim().toLowerCase() !== (profile.username ?? '') ||
      bio !== (profile.bio ?? '') ||
      avatarColor !== (profile.avatar_color ?? BaggedColors.accent)
    : false;

  const handleSaveProfile = async () => {
    if (!userId || !profile || saving) return;
    setSavedMsg(null);
    setErrorMsg(null);

    const nextUsername = username.trim().toLowerCase();
    const usernameChanged = nextUsername !== (profile.username ?? '');
    const avatarChanged = avatarColor !== (profile.avatar_color ?? BaggedColors.accent);

    if (usernameChanged) {
      if (!USERNAME_RE.test(nextUsername)) {
        setErrorMsg('Usernames are 3–20 characters: letters, numbers, _ or .');
        return;
      }
      setSaving(true);
      const available = await isUsernameAvailable({
        candidate: nextUsername,
        excludeUserId: userId,
      });
      if (!available) {
        setErrorMsg('That username is already taken.');
        setSaving(false);
        return;
      }
    } else {
      setSaving(true);
    }

    try {
      await updateOwnProfile({
        userId,
        username: usernameChanged ? nextUsername : undefined,
        bio,
        avatarColor: avatarChanged ? avatarColor : undefined,
      });
      setProfile({
        ...profile,
        username: nextUsername,
        bio,
        avatar_color: avatarChanged ? avatarColor : profile.avatar_color,
      });
      setSavedMsg('Saved');
    } catch (err) {
      console.warn('updateOwnProfile:', err);
      setErrorMsg(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordMsg(null);
    setPasswordErr(null);
    const p = newPassword.trim();
    const p2 = confirmPassword.trim();
    if (p.length < 6) {
      setPasswordErr('Password must be at least 6 characters.');
      return;
    }
    if (p !== p2) {
      setPasswordErr('Passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    try {
      await updatePassword(p);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMsg('Password updated.');
    } catch (err) {
      setPasswordErr(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You can log back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          signOut().catch((err) => console.warn('signOut failed:', err));
        },
      },
    ]);
  };

  const runDeleteAccount = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      await requestAccountDeletionRpc(DELETE_ACCOUNT_CONFIRMATION_PHRASE);
      setDeleteModalOpen(false);
      await signOut();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const missing =
        msg.includes('Could not find') ||
        msg.includes('does not exist') ||
        msg.includes('PGRST202') ||
        msg.includes('confirmation');
      Alert.alert(
        'Could not delete account',
        missing
          ? 'Account deletion is not available yet. Make sure migration 063 is applied, or contact support.'
          : msg || 'Something went wrong. Try again later.'
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  const appVersion = Constants.expoConfig?.version ?? '—';

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <View style={[styles.headerChrome, { paddingTop: insets.top + 4 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={22} color={BaggedColors.onBg} />
          </Pressable>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}>
        <KeyboardFormScroll
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 60 + Math.max(insets.bottom, 12) },
          ]}
          keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={BaggedColors.dark} />
            </View>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Edit profile</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Username</Text>
                <TextField
                  value={username}
                  onChangeText={(v) => {
                    setUsername(v);
                    if (savedMsg) setSavedMsg(null);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="username"
                  autoCapitalize="none"
                  autoCorrect={false}
                  prefix="@"
                />
                <Text style={styles.fieldHelp}>3–20 chars: letters, numbers, _ or .</Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Bio</Text>
                <TextField
                  value={bio}
                  onChangeText={(v) => {
                    setBio(v);
                    if (savedMsg) setSavedMsg(null);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="Tell people what you bag"
                  multiline
                  numberOfLines={3}
                  autoCapitalize="sentences"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Avatar color</Text>
                <View style={styles.colorGrid}>
                {AVATAR_COLORS.map((c) => {
                  const active = c === avatarColor;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => {
                        setAvatarColor(c);
                        if (savedMsg) setSavedMsg(null);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: c },
                        active && styles.colorSwatchActive,
                      ]}
                    />
                  );
                })}
                </View>
              </View>

              {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
              {savedMsg ? <Text style={styles.savedText}>{savedMsg}</Text> : null}

              <Pressable
                onPress={handleSaveProfile}
                disabled={!dirty || saving}
                style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}>
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
              </Pressable>

              {isAdmin ? (
                <>
                  <Text style={[styles.sectionLabel, styles.sectionGap]}>Admin</Text>
                  <View style={styles.card}>
                    <Pressable style={styles.cardRow} onPress={() => router.push('/admin-duplicates')}>
                      <View style={styles.cardRowText}>
                        <Text style={styles.cardTitle}>Potential duplicates</Text>
                        <Text style={styles.cardSub}>
                          {duplicateCount == null
                            ? 'Review products that may be the same'
                            : duplicateCount.total === 0
                              ? 'Nothing to review'
                              : `${duplicateCount.both} rated on both names, ${duplicateCount.total} total`}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={BaggedColors.muted} />
                    </Pressable>
                  </View>
                </>
              ) : null}

              <Text style={[styles.sectionLabel, styles.sectionGap]}>Display</Text>
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.cardRowText}>
                    <Text style={styles.cardTitle}>Tag filters on feed</Text>
                    <Text style={styles.cardSub}>Show tag filters above category pills on the feed</Text>
                  </View>
                  <Switch
                    value={showFeedDietBar}
                    onValueChange={setShowFeedDietBar}
                    trackColor={{ false: BaggedColors.border, true: BaggedColors.accent }}
                    thumbColor={BaggedColors.white}
                    ios_backgroundColor={BaggedColors.border}
                  />
                </View>
                <View style={[styles.cardRow, styles.cardRowLast]}>
                  <View style={styles.cardRowText}>
                    <Text style={styles.cardTitle}>Macros & diet tags</Text>
                    <Text style={styles.cardSub}>Show calories, macros, and diet tags on cards</Text>
                  </View>
                  <Switch
                    value={showMacroNutrition}
                    onValueChange={setShowMacroNutrition}
                    trackColor={{ false: BaggedColors.border, true: BaggedColors.accent }}
                    thumbColor={BaggedColors.white}
                    ios_backgroundColor={BaggedColors.border}
                  />
                </View>
              </View>

              <Text style={[styles.sectionLabel, styles.sectionGap]}>Security</Text>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>New password</Text>
                <TextField
                  value={newPassword}
                  onChangeText={(t) => {
                    setNewPassword(t);
                    setPasswordErr(null);
                    setPasswordMsg(null);
                  }}
                  placeholder="At least 6 characters"
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Confirm password</Text>
                <TextField
                  value={confirmPassword}
                  onChangeText={(t) => {
                    setConfirmPassword(t);
                    setPasswordErr(null);
                    setPasswordMsg(null);
                  }}
                  placeholder="Repeat password"
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
              {passwordErr ? <Text style={styles.errorText}>{passwordErr}</Text> : null}
              {passwordMsg ? <Text style={styles.savedText}>{passwordMsg}</Text> : null}
              <Pressable
                onPress={handleChangePassword}
                disabled={passwordBusy || !newPassword.trim()}
                style={[styles.secondaryBtn, (passwordBusy || !newPassword.trim()) && styles.secondaryBtnOff]}>
                <Text style={styles.secondaryBtnText}>{passwordBusy ? 'Updating…' : 'Update password'}</Text>
              </Pressable>

              <Text style={[styles.sectionLabel, styles.sectionGap]}>About</Text>
              <View style={styles.card}>
                {[
                  { label: 'Nutrition data', value: 'FatSecret' },
                  { label: 'Product search', value: 'FatSecret' },
                  { label: 'Barcode data', value: 'Open Food Facts' },
                  { label: 'Version', value: `${appVersion} beta` },
                ].map((row, i, arr) => (
                  <View
                    key={row.label}
                    style={[styles.aboutRow, i < arr.length - 1 && styles.aboutRowBorder]}>
                    <Text style={styles.aboutKey}>{row.label}</Text>
                    <Text style={styles.aboutValue}>{row.value}</Text>
                  </View>
                ))}
              </View>

              <Pressable onPress={confirmSignOut} style={styles.signOutBtn}>
                <Ionicons name="log-out-outline" size={20} color={BaggedColors.red} />
                <Text style={styles.signOutText}>Log out</Text>
              </Pressable>

              <Text style={[styles.sectionLabel, styles.sectionGap, styles.dangerLabel]}>
                Danger zone
              </Text>
              <Text style={styles.dangerHint}>
                Permanently deletes your login, profile, and every ranking. This cannot be undone.
              </Text>
              <Pressable
                onPress={() => setDeleteModalOpen(true)}
                style={styles.deleteOutlineBtn}>
                <Text style={styles.deleteOutlineText}>Delete account permanently…</Text>
              </Pressable>
            </>
          )}
        </KeyboardFormScroll>
      </KeyboardAvoidingView>

      <DeleteAccountConfirmationModal
        visible={deleteModalOpen}
        username={profile?.username ?? username}
        busy={deleteBusy}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={() => void runDeleteAccount()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BaggedColors.content },
  flex: { flex: 1, backgroundColor: BaggedColors.content },
  headerChrome: {
    backgroundColor: BaggedColors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BaggedColors.borderOnBg,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 6,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.onBg,
    textAlign: 'center',
  },
  headerSpacer: { width: 32 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  centered: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  sectionLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '700',
    color: BaggedColors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 12,
  },
  sectionGap: {
    marginTop: 28,
  },
  fieldGroup: {
    marginBottom: 20,
  },
  dangerLabel: {
    color: BaggedColors.accent,
  },
  dangerHint: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: BaggedColors.muted,
    marginBottom: 4,
  },
  fieldLabel: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    fontWeight: '600',
    color: BaggedColors.dark,
    marginBottom: 8,
  },
  fieldHelp: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    color: BaggedColors.muted,
    marginTop: 6,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchActive: {
    borderColor: BaggedColors.dark,
  },
  errorText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.accent,
    marginTop: 4,
    marginBottom: 4,
  },
  savedText: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.accent,
    marginTop: 4,
    marginBottom: 4,
    fontWeight: '600',
  },
  saveBtn: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: BaggedColors.dark,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.green,
  },
  card: {
    backgroundColor: BaggedColors.card,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    borderRadius: 14,
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
  },
  cardRowLast: {
    borderBottomWidth: 0,
  },
  cardRowText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontFamily: BaggedFonts.body,
    fontWeight: '700',
    fontSize: 15,
    color: BaggedColors.dark,
    marginBottom: 3,
  },
  cardSub: {
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.muted,
  },
  secondaryBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    alignItems: 'center',
  },
  secondaryBtnOff: {
    opacity: 0.45,
  },
  secondaryBtnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.dark,
  },
  deleteOutlineBtn: {
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BaggedColors.accent,
    alignItems: 'center',
  },
  deleteOutlineText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: BaggedColors.accent,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  aboutRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: BaggedColors.borderSoft,
  },
  aboutKey: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.dark,
  },
  aboutValue: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
    color: BaggedColors.muted,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: BaggedColors.border,
    backgroundColor: 'transparent',
  },
  signOutText: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: BaggedColors.muted,
  },
});
