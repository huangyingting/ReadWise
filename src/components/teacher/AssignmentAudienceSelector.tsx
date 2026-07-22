"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type AssignmentAudience = "class" | "students";

interface AssignmentAudienceSelectorProps {
  students: { id: string; label: string }[];
  audience: AssignmentAudience;
  onAudienceChange: (a: AssignmentAudience) => void;
  targetIds: string[];
  onToggleTarget: (id: string) => void;
}

export default function AssignmentAudienceSelector({
  students,
  audience,
  onAudienceChange,
  targetIds,
  onToggleTarget,
}: AssignmentAudienceSelectorProps) {
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <div
        role="group"
        aria-label="Assignment audience"
        className="flex flex-wrap gap-[var(--space-2)]"
      >
        <Button
          type="button"
          variant={audience === "class" ? "secondary" : "outline"}
          size="sm"
          aria-pressed={audience === "class"}
          onClick={() => onAudienceChange("class")}
        >
          Whole class
        </Button>
        <Button
          type="button"
          variant={audience === "students" ? "secondary" : "outline"}
          size="sm"
          aria-pressed={audience === "students"}
          onClick={() => onAudienceChange("students")}
        >
          Specific students
        </Button>
      </div>
      {audience === "students" ? (
        <div className="flex flex-col gap-[var(--space-2)]">
          <p className="m-0 text-[length:var(--text-xs)] text-text-muted">
            <Badge variant="neutral">{targetIds.length} selected</Badge>
          </p>
          <div
            role="group"
            aria-label="Target students"
            className="flex max-h-[calc(var(--space-6)*8)] flex-col gap-[var(--space-2)] overflow-y-auto"
          >
            {students.length > 0 ? (
              students.map((student) => {
                const isTargeted = targetIds.includes(student.id);
                return (
                  <Button
                    key={student.id}
                    type="button"
                    variant={isTargeted ? "secondary" : "outline"}
                    size="sm"
                    aria-pressed={isTargeted}
                    className="h-auto w-full justify-start whitespace-normal py-[var(--space-2)] text-left"
                    onClick={() => onToggleTarget(student.id)}
                  >
                    {student.label}
                  </Button>
                );
              })
            ) : (
              <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
                No students are enrolled yet.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
