import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';

type Props = {
  children: ReactNode;
  onClose: () => void;
};

type State = {
  error: Error | null;
};

/** Keeps a broken score-card preview from taking down the rest of the app. */
export class ShareScoreCardErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('ShareScoreCardErrorBoundary:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.children !== this.props.children && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.title}>Couldn&apos;t load shareable</Text>
          <Text style={styles.body}>The rest of Bagged is fine — try again in a moment.</Text>
          <Pressable onPress={this.props.onClose} style={styles.btn}>
            <Text style={styles.btnText}>Close</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  title: {
    fontFamily: BaggedFonts.display,
    fontSize: 18,
    color: BaggedColors.dark,
    textAlign: 'center',
  },
  body: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  btn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BaggedColors.borderStrong,
  },
  btnText: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: BaggedColors.dark,
  },
});
