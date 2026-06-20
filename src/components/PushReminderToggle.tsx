"use client";

import { useEffect, useState, useCallback } from "react";

type PermissionState = "default" | "granted" | "denied";
type ToggleState = "loading" | "unsupported" | "unconfigured" | "idle" | "subscribed" | "busy";

/**
 * Converts a VAPID public key (Base64url string) to a Uint8Array
 * required by PushManager.subscribe.
 */
function urlBase64ToUint8Array(base64url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + padding;
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/**
 * PushReminderToggle — opt-in/out UI for Web Push SRS reminders.
 *
 * Renders nothing on browsers that don't support push (e.g. iOS Safari < 16.4
 * in non-standalone mode) or when the server has no VAPID keys configured.
 */
export default function PushReminderToggle() {
  const [state, setState] = useState<ToggleState>("loading");
  const [permission, setPermission] = useState<PermissionState>("default");
  const [error, setError] = useState<string | null>(null);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  // On mount: check browser support + server config + current subscription.
  useEffect(() => {
    async function init() {
      // Browser support check
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState("unsupported");
        return;
      }

      // Fetch VAPID public key from server
      try {
        const res = await fetch("/api/push/vapid-public-key");
        if (!res.ok) {
          setState("unconfigured");
          return;
        }
        const json = await res.json();
        if (!json.configured) {
          setState("unconfigured");
          return;
        }
        setVapidKey(json.publicKey);
      } catch {
        setState("unconfigured");
        return;
      }

      const perm = Notification.permission as PermissionState;
      setPermission(perm);

      if (perm === "denied") {
        setState("idle");
        return;
      }

      // Check if already subscribed via the SW
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        setState(existing ? "subscribed" : "idle");
      } catch {
        setState("idle");
      }
    }

    init();
  }, []);

  const subscribe = useCallback(async () => {
    if (!vapidKey) return;
    setState("busy");
    setError(null);

    try {
      // Request notification permission if not yet granted
      const perm = await Notification.requestPermission();
      setPermission(perm as PermissionState);
      if (perm !== "granted") {
        setState("idle");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      // Parse the subscription to extract p256dh and auth keys
      const subJson = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to save subscription." }));
        throw new Error(err.message ?? "Failed to save subscription.");
      }

      setState("subscribed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to enable push notifications.");
      setState("idle");
    }
  }, [vapidKey]);

  const unsubscribe = useCallback(async () => {
    setState("busy");
    setError(null);

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setState("idle");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to disable push notifications.");
      setState("subscribed");
    }
  }, []);

  // Don't render unsupported / unconfigured states in the UI at all
  if (state === "loading" || state === "unsupported" || state === "unconfigured") {
    return null;
  }

  const isSubscribed = state === "subscribed";
  const isBusy = state === "busy";
  const isDenied = permission === "denied";

  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <div className="flex items-center justify-between gap-[var(--space-4)]">
        <div>
          <div className="font-medium text-text text-[length:var(--text-sm)]">
            Review reminders
          </div>
          <div className="text-text-muted text-[length:var(--text-xs)] mt-[var(--space-0-5)]">
            {isDenied
              ? "Notifications are blocked. Enable them in browser settings."
              : isSubscribed
                ? "Push notifications are enabled. You'll be reminded when SRS cards are due."
                : "Get notified when your spaced-repetition cards are due for review."}
          </div>
        </div>
        {!isDenied && (
          <button
            type="button"
            onClick={isSubscribed ? unsubscribe : subscribe}
            disabled={isBusy}
            className={
              isSubscribed
                ? "btn btn-outline text-[length:var(--text-sm)] shrink-0"
                : "btn btn-primary text-[length:var(--text-sm)] shrink-0"
            }
          >
            {isBusy
              ? isSubscribed
                ? "Disabling…"
                : "Enabling…"
              : isSubscribed
                ? "Disable"
                : "Enable"}
          </button>
        )}
      </div>
      {error && (
        <p className="text-[length:var(--text-xs)] text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
