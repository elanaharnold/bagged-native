import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/bagged/primary-button';
import { BaggedColors, BaggedFonts } from '@/constants/bagged-theme';
import { fetchProductIdentityByKey, productDescriptionKey } from '@/lib/data';

/**
 * Landing spot for a shared product link (bagged-app.com/p/<key>, opened via the universal
 * link or the baggednative:// scheme). Resolves the description_key back to a real item +
 * brand and hands off to the normal product page — this route never renders content itself.
 */
export default function SharedProductRedirect() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key?: string }>();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const descriptionKey = String(key ?? '').trim();
    if (!descriptionKey) {
      setNotFound(true);
      return;
    }
    fetchProductIdentityByKey(descriptionKey)
      .then((identity) => {
        if (cancelled) return;
        if (!identity) {
          setNotFound(true);
          return;
        }
        router.replace({
          pathname: '/product/detail',
          params: {
            item: identity.item,
            brand: identity.brand,
            descriptionKey: productDescriptionKey(identity.item, identity.brand) || descriptionKey,
          },
        });
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, router]);

  return (
    <SafeAreaView style={styles.container}>
      {notFound ? (
        <View style={styles.center}>
          <Text style={styles.title}>Couldn't find that product</Text>
          <Text style={styles.body}>It may have been merged or removed since this was shared.</Text>
          <PrimaryButton label="Go to Bagged" onPress={() => router.replace('/(tabs)')} />
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={BaggedColors.dark} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BaggedColors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontFamily: BaggedFonts.display, fontSize: 18, color: BaggedColors.dark, textAlign: 'center' },
  body: {
    fontFamily: BaggedFonts.body,
    fontSize: 14,
    color: BaggedColors.muted,
    textAlign: 'center',
    marginBottom: 8,
  },
});
