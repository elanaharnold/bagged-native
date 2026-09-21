import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Secondary = transparent with charcoal border; ghost = label-only. */
  variant?: 'primary' | 'secondary' | 'ghost';
  /**
   * Sign-up uses a charcoal background everywhere; on the dark variant we want
   * the primary button to flip to a cream surface so it still pops.
   */
  surface?: 'light' | 'dark';
};

export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  surface = 'light',
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;
  const palette = variantStyles({ variant, surface, disabled: isDisabled });

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: palette.borderWidth,
        },
        variant === 'primary' && surface === 'light' ? styles.shadow : null,
        pressed && !isDisabled ? styles.pressed : null,
      ]}>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={palette.label} />
          <Text style={[styles.label, { color: palette.label }]}>Working…</Text>
        </View>
      ) : (
        <Text style={[styles.label, { color: palette.label }]}>{label}</Text>
      )}
    </Pressable>
  );
}

function variantStyles({
  variant,
  surface,
  disabled,
}: {
  variant: 'primary' | 'secondary' | 'ghost';
  surface: 'light' | 'dark';
  disabled: boolean;
}) {
  if (variant === 'ghost') {
    return {
      bg: 'transparent',
      border: 'transparent',
      borderWidth: 0,
      label: surface === 'dark' ? 'rgba(255,255,255,0.7)' : BaggedColors.muted,
    };
  }
  if (variant === 'secondary') {
    return {
      bg: 'transparent',
      border: BaggedColors.border,
      borderWidth: 1.5,
      label: surface === 'dark' ? BaggedColors.white : BaggedColors.dark,
    };
  }
  if (surface === 'dark') {
    return {
      bg: disabled ? 'rgba(255,255,255,0.18)' : BaggedColors.cream,
      border: 'transparent',
      borderWidth: 0,
      label: BaggedColors.dark,
    };
  }
  return {
    bg: disabled ? 'rgba(0, 0, 0, 0.22)' : BaggedColors.accent,
    border: 'transparent',
    borderWidth: 0,
    label: BaggedColors.white,
  };
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  shadow: {
    shadowColor: BaggedColors.dark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 2,
  },
  label: {
    fontFamily: BaggedFonts.body,
    fontSize: 15,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
