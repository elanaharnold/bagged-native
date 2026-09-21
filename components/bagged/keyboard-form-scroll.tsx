import { forwardRef } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';

/** Scroll container for forms — keeps the focused field above the keyboard. */
export const KeyboardFormScroll = forwardRef<ScrollView, ScrollViewProps>(function KeyboardFormScroll(
  {
    keyboardShouldPersistTaps = 'handled',
    keyboardDismissMode = 'interactive',
    automaticallyAdjustKeyboardInsets = true,
    ...rest
  },
  ref
) {
  return (
    <ScrollView
      ref={ref}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      keyboardDismissMode={keyboardDismissMode}
      automaticallyAdjustKeyboardInsets={automaticallyAdjustKeyboardInsets}
      {...rest}
    />
  );
});
