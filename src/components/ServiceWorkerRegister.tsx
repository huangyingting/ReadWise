"use client";

import { useEffect } from "react";

function canRegisterServiceWorker() {
  return (
    process.env.NODE_ENV === "production" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator
  );
}

/**
 * Registers the service worker at /sw.js in production environments.
 * Only runs in browsers that support the Service Worker API.
 * Mount once in the root layout (it renders nothing).
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (canRegisterServiceWorker()) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() => console.error("[SW] Registration failed"));
    }
  }, []);

  return null;
}
