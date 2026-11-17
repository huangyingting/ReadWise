export type AssignmentAudience = "class" | "students";

export interface EditAssignmentDraft {
  dueDate: string;
  instructions: string;
  /** Write Prompt override (#1305); empty restores the article default. */
  writePrompt: string;
  title: string;
  points: string;
  audienceDirty: boolean;
  audience: AssignmentAudience;
  targetIds: string[];
  /** Reading level lock (#1303): "" = student choice; omitted for single-level articles. */
  lockedLevelKey?: string;
}

export function buildUpdatePayload({
  dueDate,
  instructions,
  writePrompt,
  title,
  points,
  audienceDirty,
  audience,
  targetIds,
  lockedLevelKey,
}: EditAssignmentDraft) {
  const payload: {
    dueDate: string;
    instructions: string;
    writePrompt: string;
    title: string;
    points: number | null;
    studentIds?: string[];
    lockedLevelKey?: string | null;
  } = {
    dueDate,
    title: title.trim(),
    points: points ? Number(points) : null,
    instructions: instructions.trim(),
    writePrompt: writePrompt.trim(),
  };

  if (lockedLevelKey !== undefined) {
    payload.lockedLevelKey = lockedLevelKey || null;
  }

  if (audienceDirty) {
    payload.studentIds = audience === "students" ? targetIds : [];
  }

  return payload;
}
