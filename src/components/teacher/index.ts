/**
 * Teacher components barrel (RW-061).
 *
 * Re-exports all public teacher-facing form components and shared primitives
 * so consumers can import from `@/components/teacher` without knowing the
 * internal file layout.
 */

export { default as AddStudentForm } from "./AddStudentForm";
export { default as AssignArticleForm } from "./AssignArticleForm";
export { default as CompleteAssignmentButton } from "./CompleteAssignmentButton";
export { default as CreateClassroomForm } from "./CreateClassroomForm";
export type { TeachableOrg } from "./CreateClassroomForm";
export { default as CreateOrgForm } from "./CreateOrgForm";
export { TeacherFormShell, useTeacherMutation } from "./TeacherFormShell";
export type { TeacherFormShellProps } from "./TeacherFormShell";
