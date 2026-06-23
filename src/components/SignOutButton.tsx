"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { type VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/Button";
import { purgeOfflineUserData } from "@/lib/offline-mutations";

export default function SignOutButton({
  callbackUrl = "/",
  variant = "outline",
  size = "md",
  label = "Sign out",
}: {
  callbackUrl?: string;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  label?: string;
}) {
  async function handleSignOut() {
    // Purge private/offline content from this device BEFORE the session ends so
    // nothing lingers on a shared device (RW-044).
    await purgeOfflineUserData();
    await signOut({ callbackUrl });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => void handleSignOut()}
    >
      {label}
    </Button>
  );
}
