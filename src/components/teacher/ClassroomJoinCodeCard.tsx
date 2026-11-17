"use client";

/**
 * Classroom join code card (#1309) for the classroom's teacher / org admin.
 *
 * Shows the current code large enough to project, with copy-code and
 * copy-link actions, its status/expiry/usage, and Generate · Rotate · Disable.
 * Rotation takes the chosen expiry and optional seat limit and invalidates the
 * previous code immediately.
 */

import { useState } from "react";
import { Copy, KeyRound, Link2, RefreshCw } from "lucide-react";
import { clientErrorMessage, deleteJson, postJson } from "@/lib/client-fetch";
import { cn } from "@/lib/cn";
import ConfirmAction from "@/components/ConfirmAction";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PanelError,
  Select,
} from "@/components/ui";
import {
  JOIN_CODE_MAX_USES_LIMIT,
  type JoinCodeStatus,
  type JoinCodeView,
} from "@/lib/classroom/join-code-format";

const EXPIRY_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "1", label: "1 day" },
  { value: "none", label: "No expiry" },
] as const;
type ExpiryOption = (typeof EXPIRY_OPTIONS)[number]["value"];

const STATUS_BADGES: Record<JoinCodeStatus, { label: string; variant: "success" | "neutral" | "warning" }> = {
  active: { label: "Active", variant: "success" },
  disabled: { label: "Disabled", variant: "neutral" },
  expired: { label: "Expired", variant: "warning" },
  exhausted: { label: "Seat limit reached", variant: "warning" },
};

type JoinCodeResponse = { ok: true; joinCode: JoinCodeView | null };

interface ClassroomJoinCodeCardProps {
  classroomId: string;
  initialJoinCode: JoinCodeView | null;
  /** False for archived classrooms: the code can be disabled but not issued. */
  canIssue: boolean;
}

function endpoint(classroomId: string): string {
  return `/api/classrooms/${encodeURIComponent(classroomId)}/join-code`;
}

function joinLink(code: string): string {
  return `${window.location.origin}/join-class?code=${encodeURIComponent(code)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function usageText(view: JoinCodeView): string {
  const joined = `${view.useCount} joined`;
  return view.maxUses === null ? joined : `${joined} of ${view.maxUses}`;
}

export default function ClassroomJoinCodeCard({
  classroomId,
  initialJoinCode,
  canIssue,
}: ClassroomJoinCodeCardProps) {
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [expiry, setExpiry] = useState<ExpiryOption>("7");
  const [maxUses, setMaxUses] = useState("");
  const [pending, setPending] = useState<"rotate" | "disable" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedMaxUses = maxUses.trim() === "" ? null : Number(maxUses);
  const maxUsesValid =
    parsedMaxUses === null ||
    (Number.isInteger(parsedMaxUses) && parsedMaxUses >= 1 && parsedMaxUses <= JOIN_CODE_MAX_USES_LIMIT);

  async function rotate() {
    setPending("rotate");
    setError(null);
    setMessage(null);
    try {
      const res = await postJson<JoinCodeResponse>(endpoint(classroomId), {
        expiresInDays: expiry === "none" ? null : Number(expiry),
        maxUses: parsedMaxUses,
      });
      setMessage(joinCode ? "New code issued. The previous code no longer works." : "Join code created.");
      setJoinCode(res.joinCode);
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t issue a join code."));
    } finally {
      setPending(null);
    }
  }

  async function disable() {
    setPending("disable");
    setError(null);
    setMessage(null);
    try {
      const res = await deleteJson<JoinCodeResponse>(endpoint(classroomId));
      setJoinCode(res.joinCode);
      setMessage("Join code disabled.");
    } catch (err) {
      setError(clientErrorMessage(err, "Couldn’t disable the join code."));
    } finally {
      setPending(null);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(`${label} copied.`);
    } catch {
      setError("Copy failed — select the text and copy it manually.");
    }
  }

  const status = joinCode ? STATUS_BADGES[joinCode.status] : null;
  const isActive = joinCode?.status === "active";
  const disableAction =
    joinCode && joinCode.status !== "disabled" ? (
      <ConfirmAction
        triggerLabel="Disable"
        triggerAriaLabel="Disable join code"
        triggerVariant="danger-ghost"
        confirmVariant="danger"
        confirmLabel="Disable code"
        confirmMessage="Students won’t be able to join with this code. Existing students stay enrolled."
        onConfirm={disable}
        loading={pending === "disable"}
        disabled={pending !== null}
      />
    ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join code</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-4)]">
        {joinCode ? (
          <div className="flex flex-col gap-[var(--space-2)]">
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <code
                aria-label="Classroom join code"
                className={cn(
                  "font-mono text-[length:var(--type-metric)] font-semibold tracking-widest",
                  isActive ? "text-text" : "text-text-muted line-through",
                )}
              >
                {joinCode.displayCode}
              </code>
              {status ? <Badge variant={status.variant}>{status.label}</Badge> : null}
            </div>
            <p className="m-0 text-[length:var(--type-label)] text-text-muted">
              {usageText(joinCode)}
              {joinCode.expiresAt ? ` · expires ${formatDate(joinCode.expiresAt)}` : " · no expiry"}
            </p>
            {isActive ? (
              <div className="flex flex-wrap gap-[var(--space-2)]">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leadingIcon={<Copy size={14} aria-hidden />}
                  onClick={() => void copy(joinCode.displayCode, "Code")}
                >
                  Copy code
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leadingIcon={<Link2 size={14} aria-hidden />}
                  onClick={() => void copy(joinLink(joinCode.displayCode), "Join link")}
                >
                  Copy join link
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="m-0 text-[length:var(--type-ui)] text-text-muted">
            Students can enroll themselves by entering a join code at <span className="font-medium">/join-class</span>.
          </p>
        )}

        {canIssue ? (
          <div className="flex flex-col gap-[var(--space-3)]">
            <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
              <Field label="Code expires after">
                <Select value={expiry} onChange={(event) => setExpiry(event.target.value as ExpiryOption)}>
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Seat limit"
                hint="Optional"
                error={maxUsesValid ? undefined : `Use a whole number from 1 to ${JOIN_CODE_MAX_USES_LIMIT}.`}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={JOIN_CODE_MAX_USES_LIMIT}
                  value={maxUses}
                  placeholder="Unlimited"
                  onChange={(event) => setMaxUses(event.target.value)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <Button
                type="button"
                variant={joinCode ? "outline" : "primary"}
                size="sm"
                loading={pending === "rotate"}
                disabled={pending !== null || !maxUsesValid}
                leadingIcon={joinCode ? <RefreshCw size={14} aria-hidden /> : <KeyRound size={14} aria-hidden />}
                onClick={() => void rotate()}
              >
                {joinCode ? "Rotate code" : "Generate code"}
              </Button>
              {disableAction}
            </div>
          </div>
        ) : (
          disableAction
        )}

        {message ? (
          <p role="status" className="m-0 text-[length:var(--type-ui)] text-text-muted">
            {message}
          </p>
        ) : null}
        {error ? <PanelError message={error} /> : null}
      </CardBody>
    </Card>
  );
}
