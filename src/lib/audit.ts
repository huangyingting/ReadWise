import { prisma } from "@/lib/prisma";
import { createLogger, getRequestContext } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

export const AUDIT_ACTIONS = {
  adminArticleDelete: "admin.article.delete",
  adminArticleRebuild: "admin.article.rebuild_ai",
  adminArticleIngest: "admin.article.ingest",
  adminMemberRoleUpdate: "admin.member.role_update",
  adminMemberDelete: "admin.member.delete",
  adminTagRename: "admin.tag.rename",
  adminTagDelete: "admin.tag.delete",
  adminTagMerge: "admin.tag.merge",
  adminScrapeTrigger: "admin.scrape.trigger",
  adminJobRetry: "admin.job.retry",
  adminJobCancel: "admin.job.cancel",
  adminJobArchive: "admin.job.archive",
  adminJobBackfill: "admin.job.backfill",
  articleImport: "article.import",
  accountExport: "account.export",
  accountDelete: "account.delete",
  securityAdminAccessDenied: "security.admin_access_denied",
  adminAuditLogRead: "admin.audit_logs.read",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
export type AuditMetadataValue =
  | string
  | number
  | boolean
  | null
  | AuditMetadataValue[]
  | { [key: string]: AuditMetadataValue };
export type AuditMetadata = Record<string, AuditMetadataValue>;

type AuditSession = {
  user?: {
    id?: string | null;
    role?: string | null;
  } | null;
} | null;

export type AuditLogInput = {
  action: AuditAction | string;
  actorId?: string | null;
  actorRole?: string | null;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditRequestInput = Omit<
  AuditLogInput,
  "actorId" | "actorRole" | "ipAddress" | "userAgent"
> & {
  req: Request;
  session?: AuditSession;
};

export type AuditLogRow = {
  id: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string;
  targetId: string | null;
  metadata: AuditMetadata;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
};

export type AuditClient = Pick<Prisma.TransactionClient, "auditLog">;

export type ListAuditLogsOptions = {
  page?: number;
  pageSize?: number;
  action?: string | null;
  actorId?: string | null;
  targetType?: string | null;
};

const logger = createLogger("audit");
const MAX_METADATA_KEYS = 25;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 512;
const REDACTED = "[redacted]";
const SENSITIVE_KEY_RE =
  /(authorization|cookie|credential|email|key|password|pass|pwd|secret|session|token|url)/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const TOKENISH_RE = /\b(?:bearer\s+)?(?:[A-Za-z0-9_-]{24,}\.){1,2}[A-Za-z0-9_-]{16,}\b/i;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function normalizeOptionalString(value: string | null | undefined, max = MAX_STRING_LENGTH): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned ? truncate(cleaned, max) : null;
}

function redactSensitiveString(value: string): string {
  if (EMAIL_RE.test(value) || TOKENISH_RE.test(value)) return REDACTED;
  return truncate(value, MAX_STRING_LENGTH);
}

function sanitizeValue(value: unknown, depth: number): AuditMetadataValue {
  if (depth > 3) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactSensitiveString(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, AuditMetadataValue> = {};
    for (const [key, nested] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
      out[truncate(key, 80)] = SENSITIVE_KEY_RE.test(key)
        ? REDACTED
        : sanitizeValue(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function sanitizeAuditMetadata(input: Record<string, unknown> | null | undefined): AuditMetadata {
  if (!input) return {};
  const out: AuditMetadata = {};
  for (const [key, value] of Object.entries(input).slice(0, MAX_METADATA_KEYS)) {
    out[truncate(key, 80)] = SENSITIVE_KEY_RE.test(key)
      ? REDACTED
      : sanitizeValue(value, 0);
  }
  return out;
}

function firstHeader(req: Request, names: string[]): string | null {
  for (const name of names) {
    const value = req.headers.get(name);
    if (value) return value;
  }
  return null;
}

export function auditRequestInfo(req: Request): Pick<AuditLogInput, "ipAddress" | "userAgent"> {
  const forwardedFor = firstHeader(req, ["x-forwarded-for", "x-real-ip", "cf-connecting-ip"]);
  const ipAddress = normalizeOptionalString(forwardedFor?.split(",")[0], 128);
  const userAgent = normalizeOptionalString(req.headers.get("user-agent"), MAX_USER_AGENT_LENGTH);
  return { ipAddress, userAgent };
}

function parseMetadata(raw: string): AuditMetadata {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? sanitizeAuditMetadata(parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function recordAuditLog(
  input: AuditLogInput,
  client: AuditClient = prisma,
): Promise<void> {
  const requestContext = getRequestContext();
  const data = {
    action: truncate(input.action, 120),
    actorId: normalizeOptionalString(input.actorId, 200),
    actorRole: normalizeOptionalString(input.actorRole, 50),
    targetType: truncate(input.targetType, 80),
    targetId: normalizeOptionalString(input.targetId, 200),
    metadata: JSON.stringify(sanitizeAuditMetadata(input.metadata)),
    requestId: normalizeOptionalString(input.requestId ?? requestContext?.requestId, 100),
    ipAddress: normalizeOptionalString(input.ipAddress, 128),
    userAgent: normalizeOptionalString(input.userAgent, MAX_USER_AGENT_LENGTH),
  };

  try {
    await client.auditLog.create({ data });
  } catch (err) {
    logger.error("audit.write_failed", {
      action: data.action,
      targetType: data.targetType,
      targetId: data.targetId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function tryRecordAuditLog(
  input: AuditLogInput,
  client: AuditClient = prisma,
): Promise<void> {
  try {
    await recordAuditLog(input, client);
  } catch {
    // recordAuditLog already emits the structured failure. This best-effort path
    // is used only for denied access attempts where preserving the auth response
    // is more important than surfacing an audit persistence error to the client.
  }
}

export function auditInputFromRequest(input: AuditRequestInput): AuditLogInput {
  const { req, session, ...rest } = input;
  return {
    ...rest,
    actorId: session?.user?.id ?? null,
    actorRole: session?.user?.role ?? null,
    ...auditRequestInfo(req),
  };
}

export async function recordAuditFromRequest(
  input: AuditRequestInput,
  client: AuditClient = prisma,
): Promise<void> {
  await recordAuditLog(auditInputFromRequest(input), client);
}

export async function listAuditLogs(
  opts: ListAuditLogsOptions = {},
  client: AuditClient = prisma,
) {
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const where = {
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.actorId ? { actorId: opts.actorId } : {}),
    ...(opts.targetType ? { targetType: opts.targetType } : {}),
  };

  const [total, rows] = await Promise.all([
    client.auditLog.count({ where }),
    client.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const logs: AuditLogRow[] = rows.map((row) => ({
    ...row,
    metadata: parseMetadata(row.metadata),
  }));

  return {
    logs,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
