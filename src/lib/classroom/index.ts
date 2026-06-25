/**
 * Classrooms, assignments & teacher workflows — public API (Epic RW-E012 — RW-061).
 *
 * This barrel is the public classroom API over the focused sub-modules:
 *
 *   - {@link ./guards}        — boolean authorization helpers
 *   - {@link ./queries}       — classroom and roster reads
 *   - {@link ./commands}      — classroom, roster, and assignment writes
 *   - {@link ./completions}   — assignment completion commands
 *   - {@link ./student-reads} — student-facing assignment reads
 *   - {@link ./progress}      — raw progress matrix for analytics
 *
 * Authorization layers on top of `@/lib/org`:
 *   - System admins manage any classroom.
 *   - Org admins (the `org.manage` capability) manage any classroom in their org.
 *   - A classroom's own teacher manages that classroom.
 *   - Students only receive assignments and report their own completion.
 *
 * Aggregated, privacy-aware class analytics live in `@/lib/analytics/tenant`;
 * this module owns the CRUD + raw progress fetch they build on.
 */
export {
  type ClassroomViewer,
  canCreateClassroom,
  canManageClassroom,
} from "./guards";
export {
  type ClassroomMemberRow,
  getClassroom,
  listClassroomsForOrg,
  listClassroomsForTeacher,
  listClassroomsForStudent,
  listClassroomMembers,
} from "./queries";
export {
  type CreateClassroomInput,
  type AssignArticleInput,
  createClassroom,
  addClassroomMember,
  removeClassroomMember,
  assignArticle,
  deleteAssignment,
} from "./commands";
export {
  type RecordCompletionInput,
  getStudentAssignmentContext,
  recordAssignmentCompletion,
} from "./completions";
export {
  type StudentAssignment,
  listAssignmentsForStudent,
} from "./student-reads";
export {
  type ClassroomProgressStudent,
  type ClassroomProgressAssignment,
  type ClassroomProgressCompletion,
  type ClassroomProgressData,
  getClassroomProgressData,
} from "./progress";
