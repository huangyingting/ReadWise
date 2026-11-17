/**
 * Educator reader context (#1304): whether the viewer gets educator tools on
 * the reader, whether they are previewing the student view (`?view=student`),
 * the reading-level lock to preview, and the classrooms they can assign to.
 */
import { prisma } from "@/lib/prisma";
import { isEducator, listManagedClassrooms } from "@/lib/classroom/educator";
import { teachingAssignments } from "@/lib/classroom/annotations";

type Viewer = { id: string; role?: string | null };

export type EducatorReaderContext = {
  isEducator: boolean;
  /** True while an educator previews the student experience. */
  previewing: boolean;
  /** Level lock of the educator's first locked assignment of the article, applied in preview. */
  previewLock: string | null;
  /** Active classrooms the educator manages (quick assign); empty in preview. */
  classrooms: Array<{ id: string; name: string }>;
};

const NOT_EDUCATOR: EducatorReaderContext = { isEducator: false, previewing: false, previewLock: null, classrooms: [] };

export async function loadEducatorReaderContext(viewer: Viewer, articleId: string, view: unknown): Promise<EducatorReaderContext> {
  if (!(await isEducator(viewer))) return NOT_EDUCATOR;
  if (view !== "student") {
    return { isEducator: true, previewing: false, previewLock: null, classrooms: await listManagedClassrooms(viewer) };
  }
  const teaching = await teachingAssignments(viewer, articleId);
  const locked = teaching.length
    ? await prisma.assignment.findFirst({
        where: { id: { in: teaching.map((entry) => entry.assignmentId) }, lockedLevelKey: { not: null } },
        select: { lockedLevelKey: true },
        orderBy: { createdAt: "asc" },
      })
    : null;
  return { isEducator: true, previewing: true, previewLock: locked?.lockedLevelKey ?? null, classrooms: [] };
}
