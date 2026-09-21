import { StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

type AvatarProps = {
  char: string;
  color?: string | null;
  size?: number;
  borderColor?: string;
};

export function Avatar({ char, color, size = 36, borderColor = BaggedColors.dark }: AvatarProps) {
  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color || BaggedColors.accent,
          borderColor,
        },
      ]}>
      <Text
        style={[
          styles.label,
          {
            fontSize: size * 0.45,
            fontFamily: BaggedFonts.display,
          },
        ]}>
        {char}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  label: {
    color: BaggedColors.green,
    fontWeight: '400',
  },
});
