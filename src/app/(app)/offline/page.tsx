/**
 * Offline Library page (#117)
 *
 * Lists articles saved for offline reading. Reads entirely from IndexedDB —
 * no server requests — so this page works when the user is offline (JS bundles
 * are cached by the service worker).
 *
 * The route is server-gated via requireSession, while the IndexedDB-backed
 * library itself lives in OfflineLibraryClient.
 */

import { requireSession } from "@/lib/session";
import OfflineLibraryClient from "./OfflineLibraryClient";

export default async function OfflineLibraryPage() {
  await requireSession("/offline");
  return <OfflineLibraryClient />;
}
