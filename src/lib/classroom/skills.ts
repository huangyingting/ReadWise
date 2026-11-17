/**
 * Classroom reading-skills matrix (#1302).
 *
 * Aggregates graded quiz answers by reading skill for a classroom's enrolled
 * students, scoped to the classroom's assigned articles. Each student's MOST
 * RECENT attempt per article counts, so retakes don't double-weight a skill.
 * With `individual: false` (org-admin aggregate view) only class totals are
 * returned — no per-student rows.
 */
import { prisma } from "@/lib/prisma";
import { isReadingSkill, READING_SKILL_KEYS, type ReadingSkill } from "@/lib/learning/reading-skills";

export type SkillCell = { correct: number; total: number };

export type SkillMatrixStudent = {
  studentId: string;
  name: string | null;
  email: string | null;
  cells: Partial<Record<ReadingSkill, SkillCell>>;
};

export type ClassroomSkillMatrix = {
  /** Every skill, in taxonomy order. */
  skills: readonly ReadingSkill[];
  classTotals: Partial<Record<ReadingSkill, SkillCell>>;
  /** Per-student rows; null when individual data is not visible. */
  students: SkillMatrixStudent[] | null;
  /** Graded attempts that contributed. */
  attemptCount: number;
};

function addToCell(cells: Partial<Record<ReadingSkill, SkillCell>>, skill: ReadingSkill, correct: boolean): void {
  const cell = cells[skill] ?? { correct: 0, total: 0 };
  cell.total += 1;
  if (correct) cell.correct += 1;
  cells[skill] = cell;
}

/** Percentage for a cell, or null when there is no evidence. */
export function skillCellPercent(cell: SkillCell | undefined): number | null {
  return cell && cell.total > 0 ? Math.round((cell.correct / cell.total) * 100) : null;
}

export async function getClassroomSkillMatrix(
  classroomId: string,
  options: { individual: boolean },
): Promise<ClassroomSkillMatrix> {
  const [members, assignments] = await Promise.all([
    prisma.classroomMembership.findMany({
      where: { classroomId, role: "Student" },
      select: { userId: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.assignment.findMany({
      where: { classroomId },
      select: { articleId: true },
    }),
  ]);
  const studentIds = members.map((member) => member.userId);
  const articleIds = [...new Set(assignments.map((assignment) => assignment.articleId))];

  const attempts =
    studentIds.length > 0 && articleIds.length > 0
      ? await prisma.quizAttempt.findMany({
          where: { userId: { in: studentIds }, articleId: { in: articleIds } },
          select: { id: true, userId: true, articleId: true },
          orderBy: { completedAt: "desc" },
        })
      : [];
  const latest = new Map<string, { id: string; userId: string }>();
  for (const attempt of attempts) {
    const key = `${attempt.userId}:${attempt.articleId}`;
    if (!latest.has(key)) latest.set(key, attempt);
  }
  const ownerByAttempt = new Map([...latest.values()].map((attempt) => [attempt.id, attempt.userId]));

  const answers =
    ownerByAttempt.size > 0
      ? await prisma.quizAttemptAnswer.findMany({
          where: { attemptId: { in: [...ownerByAttempt.keys()] } },
          select: { attemptId: true, skillTag: true, correct: true },
        })
      : [];

  const classTotals: Partial<Record<ReadingSkill, SkillCell>> = {};
  const byStudent = new Map<string, Partial<Record<ReadingSkill, SkillCell>>>();
  for (const answer of answers) {
    if (!isReadingSkill(answer.skillTag)) continue;
    addToCell(classTotals, answer.skillTag, answer.correct);
    const studentId = ownerByAttempt.get(answer.attemptId)!;
    const cells = byStudent.get(studentId) ?? {};
    addToCell(cells, answer.skillTag, answer.correct);
    byStudent.set(studentId, cells);
  }

  return {
    skills: READING_SKILL_KEYS,
    classTotals,
    students: options.individual
      ? members.map((member) => ({
          studentId: member.userId,
          name: member.user.name,
          email: member.user.email,
          cells: byStudent.get(member.userId) ?? {},
        }))
      : null,
    attemptCount: ownerByAttempt.size,
  };
}
