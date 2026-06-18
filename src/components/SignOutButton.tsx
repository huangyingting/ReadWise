"use client";

import { signOut } from "next-auth/react";

export default function SignOutButton({
  callbackUrl = "/",
  className = "btn",
  label = "Sign out",
}: {
  callbackUrl?: string;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => signOut({ callbackUrl })}
    >
      {label}
    </button>
  );
}
