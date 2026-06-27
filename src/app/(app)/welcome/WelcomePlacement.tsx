"use client";

import { useState } from "react";
import { ReadingPlacementCard } from "@/components/placement/ReadingPlacementCard";
import type { PlacementSeedLevel } from "@/lib/learning/placement";

/**
 * One-time placement prompt on the post-onboarding welcome screen (#806).
 * Self-dismissing: hides after the learner finishes or skips so the welcome
 * tour is never blocked.
 */
export function WelcomePlacement({ seedLevel }: { seedLevel: PlacementSeedLevel }) {
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <div className="mb-[var(--space-6)]">
      <ReadingPlacementCard
        seedLevel={seedLevel}
        attempt="initial"
        onDone={() => setDone(true)}
      />
    </div>
  );
}

export default WelcomePlacement;
