"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardMeta, CardBody, Button } from "@/components/ui";
import { ReadingPlacementCard } from "@/components/placement/ReadingPlacementCard";
import type { PlacementSeedLevel } from "@/lib/learning/placement";

/**
 * Settings "Retake placement" affordance (#806). Reveals the placement card on
 * demand and posts `attempt = "retake"`, upserting the learner's single
 * PlacementResult row. Refreshes server data on completion so the new
 * recommended level feeds Today.
 */
export function RetakePlacement({ seedLevel }: { seedLevel: PlacementSeedLevel }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  if (open) {
    return (
      <ReadingPlacementCard
        seedLevel={seedLevel}
        attempt="retake"
        onDone={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle level="h2">Reading placement</CardTitle>
        <CardMeta>
          Take a short reading check so your recommendations match your current
          level. You can retake it any time.
        </CardMeta>
      </CardHeader>
      <CardBody>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Retake placement
        </Button>
      </CardBody>
    </Card>
  );
}

export default RetakePlacement;
