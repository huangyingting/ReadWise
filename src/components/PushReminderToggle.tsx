"use client";

import { useEffect, useState, useCallback } from "react";
import { postJson } from "@/lib/client-fetch";
import { Switch } from "@/components/ui/Switch";
import { SkeletonText } from "@/components/ui/Skeleton";
import { ui as pushUi } from "@/lib/copy/push";

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
        // non-standard init response: checks configured flag before JSON, not using postJson
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
      await postJson("/api/push/subscribe", {
        endpoint: subJson.endpoint,
        p256dh: subJson.keys?.p256dh,
        auth: subJson.keys?.auth,
      });
      setState("subscribed");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : pushUi.subscribeError);
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
        await postJson("/api/push/unsubscribe", { endpoint });
      }
      setState("idle");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : pushUi.unsubscribeError);
      setState("subscribed");
    }
  }, []);

  // Loading: show a skeleton row while checking browser/server support
  if (state === "loading") {
    return <SkeletonText lines={1} className="w-3/4" />;
  }

  // Unsupported browser (e.g. iOS Safari pre-16.4 in non-standalone mode)
  if (state === "unsupported") {
    return (
      <p className="text-[length:var(--text-sm)] text-text-muted m-0">
        {pushUi.unsupportedText}
      </p>
    );
  }

  // VAPID not configured server-side — settings page hides the entire card,
  // but guard here too in case this component is rendered directly.
  if (state === "unconfigured") {
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
            {pushUi.toggleLabel}
          </div>
          <div className="mt-[calc(var(--space-1)/2)] text-text-muted text-[length:var(--text-xs)]">
            {isDenied
              ? pushUi.deniedInfo
              : isSubscribed
                ? pushUi.subscribedInfo
                : pushUi.subscribePrompt}
          </div>
        </div>
        {isDenied ? null : (
          <Switch
            checked={isSubscribed}
            onCheckedChange={isSubscribed ? () => void unsubscribe() : () => void subscribe()}
            disabled={isBusy}
            aria-label={isSubscribed ? pushUi.disableAriaLabel : pushUi.enableAriaLabel}
            className="shrink-0"
          />
        )}
      </div>
      {isBusy && (
        <p className="text-[length:var(--text-xs)] text-text-muted" aria-live="polite">
          {isSubscribed ? pushUi.disablingText : pushUi.enablingText}
        </p>
      )}
      {error && (
        <p className="text-[length:var(--text-xs)] text-danger-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
