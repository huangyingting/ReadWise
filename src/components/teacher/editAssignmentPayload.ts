export type AssignmentAudience = "class" | "students";

export interface EditAssignmentDraft {
  dueDate: string;
  instructions: string;
  title: string;
  points: string;
  audienceDirty: boolean;
  audience: AssignmentAudience;
  targetIds: string[];
}

export function buildUpdatePayload({
  dueDate,
  instructions,
  title,
  points,
  audienceDirty,
  audience,
  targetIds,
}: EditAssignmentDraft) {
  const payload: {
    dueDate: string;
    instructions: string;
    title: string;
    points: number | null;
    studentIds?: string[];
  } = {
    dueDate,
    title: title.trim(),
    points: points ? Number(points) : null,
    instructions: instructions.trim(),
  };

  if (audienceDirty) {
    payload.studentIds = audience === "students" ? targetIds : [];
  }

  return payload;
}
