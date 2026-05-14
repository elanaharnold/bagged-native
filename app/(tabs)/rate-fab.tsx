/**
 * Placeholder route for the center FAB. The tab layout overrides `tabBarButton`
 * so this screen never mounts — the Rate flow lives at `/rate` as a modal.
 */
import { Redirect } from 'expo-router';

export default function RateFabPlaceholder() {
  return <Redirect href="/rate" />;
}
