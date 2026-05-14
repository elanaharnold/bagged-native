import { StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

type AvatarProps = {
  char: string;
  color?: string | null;
  size?: number;
};

export function Avatar({ char, color, size = 36 }: AvatarProps) {
  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color || BaggedColors.accent,
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
    borderColor: BaggedColors.dark,
  },
  label: {
    color: '#FFFFFF',
    fontWeight: '400',
  },
});
