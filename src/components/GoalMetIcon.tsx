"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

interface GoalMetIconProps {
  size: number;
}

/**
 * Animated check icon for the DailyGoal card.
 *
 * Uses the client boundary so the `rw-pop` class is never in the SSR HTML — the
 * animation does not fire on initial paint when the goal was already met.
 * It fires only on a reactive not-met → met transition within the session
 * (detected by the component going from unmounted to mounted).
 */
export function GoalMetIcon({ size }: GoalMetIconProps) {
  const isFirstMount = useRef(true);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    if (isFirstMount.current) {
      // Suppress animation on the initial SSR/hydration paint.
      isFirstMount.current = false;
      return;
    }
    // Reactive mount: goal just became met this session — play the pop.
    setPop(true);
  }, []);

  return (
    <Check
      size={size}
      aria-hidden
      className={cn("text-[color:var(--success-text)]", pop && "rw-pop")}
    />
  );
}
