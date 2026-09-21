import { forwardRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

export type TextFieldVariant = 'light' | 'dark';

type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label?: string;
  /** Overrides label for in-line "Forgot password?" link rendering. */
  labelRight?: React.ReactNode;
  errorText?: string | null;
  helperText?: string | null;
  variant?: TextFieldVariant;
  /** When true, renders a show/hide toggle on the right edge. */
  togglePassword?: boolean;
  prefix?: string;
  /** Prevents iOS/Android autofill yellow overlay on non-credential fields (e.g. product search). */
  disableAutofill?: boolean;
  /** Extra styles merged onto the underlying `TextInput`. */
  inputStyle?: TextInputProps['style'];
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    labelRight,
    errorText,
    helperText,
    variant = 'light',
    togglePassword,
    secureTextEntry,
    prefix,
    disableAutofill = false,
    inputStyle,
    ...rest
  },
  ref
) {
  const [showSecret, setShowSecret] = useState(false);
  const palette = variant === 'dark' ? darkPalette : lightPalette;
  const hasError = Boolean(errorText);
  const autofillOff =
    disableAutofill && !togglePassword
      ? {
          textContentType: 'none' as const,
          autoComplete: 'off' as const,
          ...(Platform.OS === 'android' ? { importantForAutofill: 'no' as const } : {}),
        }
      : {};

  return (
    <View style={styles.wrapper}>
      {(label || labelRight) && (
        <View style={styles.labelRow}>
          {label ? (
            <Text style={[styles.label, { color: palette.labelColor }]}>{label}</Text>
          ) : (
            <View />
          )}
          {labelRight ?? null}
        </View>
      )}
      <View style={styles.inputRow}>
        {prefix ? (
          <Text
            style={[
              styles.prefix,
              {
                color: palette.prefixColor,
              },
            ]}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={ref}
          {...rest}
          {...autofillOff}
          secureTextEntry={togglePassword ? !showSecret : secureTextEntry}
          placeholderTextColor={palette.placeholder}
          selectionColor={variant === 'dark' ? 'rgba(255,255,255,0.45)' : undefined}
          cursorColor={variant === 'dark' ? BaggedColors.white : undefined}
          style={[
            styles.input,
            {
              backgroundColor: palette.inputBg,
              borderColor: hasError ? BaggedColors.accent : palette.inputBorder,
              color: palette.inputText,
              paddingLeft: prefix ? 36 : 14,
              paddingRight: togglePassword ? 56 : 14,
            },
            inputStyle,
          ]}
        />
        {togglePassword ? (
          <Pressable
            onPress={() => setShowSecret((p) => !p)}
            hitSlop={8}
            style={styles.toggle}
            accessibilityRole="button"
            accessibilityLabel={showSecret ? 'Hide password' : 'Show password'}>
            <Text style={[styles.toggleText, { color: palette.helperColor }]}>
              {showSecret ? 'hide' : 'show'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {errorText ? (
        <Text style={styles.error}>{errorText}</Text>
      ) : helperText ? (
        <Text style={[styles.helper, { color: palette.helperColor }]}>{helperText}</Text>
      ) : null}
    </View>
  );
});

const lightPalette = {
  labelColor: BaggedColors.muted,
  inputBg: BaggedColors.white,
  inputBorder: BaggedColors.border,
  inputText: BaggedColors.dark,
  placeholder: 'rgba(0, 0, 0, 0.32)',
  helperColor: BaggedColors.muted,
  prefixColor: 'rgba(0, 0, 0, 0.32)',
};

/** For dark surfaces only (e.g. sign-up, onboarding). Do not use on cream backgrounds. */
const darkPalette = {
  labelColor: 'rgba(255,255,255,0.55)',
  inputBg: '#1A1A1A',
  inputBorder: 'rgba(255,255,255,0.15)',
  inputText: BaggedColors.white,
  placeholder: 'rgba(255,255,255,0.35)',
  helperColor: 'rgba(255,255,255,0.45)',
  prefixColor: 'rgba(255,255,255,0.35)',
};

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  label: {
    fontFamily: BaggedFonts.body,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.65,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    width: '100%',
    paddingVertical: 14,
    borderWidth: 1.5,
    borderRadius: 12,
    fontFamily: BaggedFonts.body,
    fontSize: 16,
  },
  prefix: {
    position: 'absolute',
    left: 16,
    zIndex: 1,
    fontFamily: BaggedFonts.body,
    fontSize: 16,
  },
  toggle: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  toggleText: {
    fontFamily: BaggedFonts.body,
    fontSize: 13,
  },
  error: {
    marginTop: 6,
    fontFamily: BaggedFonts.body,
    fontSize: 12,
    color: BaggedColors.accent,
  },
  helper: {
    marginTop: 6,
    fontFamily: BaggedFonts.body,
    fontSize: 12,
  },
});
