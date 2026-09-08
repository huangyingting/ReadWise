"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import type { ReactNode } from "react";
import OfflineSyncIndicator from "@/components/OfflineSyncIndicator";

interface ProvidersProps {
  children: ReactNode;
  session: Session | null;
}

export default function Providers({ children, session }: ProvidersProps) {
  return (
    <SessionProvider session={session}>
      <OfflineSyncIndicator>{children}</OfflineSyncIndicator>
    </SessionProvider>
  );
}
