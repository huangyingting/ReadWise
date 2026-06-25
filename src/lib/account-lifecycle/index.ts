/**
 * Account lifecycle subsystem (REF-052 — Issue #489).
 *
 * Consolidates account lifecycle (create/deactivate/delete), privacy
 * export/delete (GDPR-style data export + deletion), and admin member-support
 * workflows into cohesive modules with narrow boundaries.
 *
 * Module layout:
 *   account-commands  — User self-service: exportUserData, deleteOwnAccount
 *   member-list       — Admin member list read model: listMembers
 *   member-commands   — Admin member mutations: updateMemberRole, deleteMember
 *   member-detail     — Admin member detail read model: getMemberDetail
 *   support-commands  — Operator support: revokeMemberSessions, exportMemberData,
 *                       triggerMemberRepair, resendSignInHelp
 *
 * Importers should use this barrel or the focused modules above directly.
 */

export * from "./account-commands";
export * from "./member-list";
export * from "./member-commands";
export * from "./member-detail";
export * from "./support-commands";
