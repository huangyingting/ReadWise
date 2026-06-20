"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";
import { type VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/Button";

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
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => signOut({ callbackUrl })}
    >
      {label}
    </Button>
  );
}
