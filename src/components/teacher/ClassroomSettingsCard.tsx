"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiResponseError,
  clientErrorMessage,
  deleteJson,
  patchJson,
} from "@/lib/client-fetch";
import ConfirmAction from "@/components/ConfirmAction";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PanelError,
} from "@/components/ui";
import { TeacherFormShell } from "./TeacherFormShell";

type ClassroomLifecycleResponse = {
  ok: boolean;
  classroom: {
    id: string;
    name: string;
    archivedAt: string | null;
  };
};

interface ClassroomSettingsCardProps {
  classroomId: string;
  classroomName: string;
  archivedAt: string | null;
}

const CLASSROOM_NAME_MAX_LENGTH = 120;
const EMPTY_CLASSROOM_DELETE_MESSAGE =
  "Classroom isn't empty — remove students and assignments first.";

function classroomEndpoint(classroomId: string): string {
  return `/api/classrooms/${encodeURIComponent(classroomId)}`;
}

function lifecycleErrorMessage(error: unknown, fallback: string): string {
  return clientErrorMessage(error, fallback);
}

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiResponseError && error.status === 409) {
    return EMPTY_CLASSROOM_DELETE_MESSAGE;
  }
  return lifecycleErrorMessage(error, "Couldn’t delete classroom.");
}

export default function ClassroomSettingsCard({
  classroomId,
  classroomName,
  archivedAt,
}: ClassroomSettingsCardProps) {
  const router = useRouter();
  const isArchived = archivedAt != null;
  const [name, setName] = useState(classroomName);
  const [renamePending, setRenamePending] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function renameClassroom(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0 || trimmedName === classroomName || renamePending) return;

    setRenamePending(true);
    setError(null);
    setMessage(null);
    try {
      await patchJson<ClassroomLifecycleResponse>(classroomEndpoint(classroomId), {
        name: trimmedName,
      });
      setMessage("Classroom name saved.");
      router.refresh();
    } catch (err) {
      setError(lifecycleErrorMessage(err, "Couldn’t rename classroom."));
    } finally {
      setRenamePending(false);
    }
  }

  async function setArchived(archived: boolean) {
    setArchivePending(true);
    setError(null);
    setMessage(null);
    try {
      await patchJson<ClassroomLifecycleResponse>(classroomEndpoint(classroomId), {
        archived,
      });
      router.refresh();
    } catch (err) {
      setError(lifecycleErrorMessage(err, archived ? "Couldn’t archive classroom." : "Couldn’t unarchive classroom."));
    } finally {
      setArchivePending(false);
    }
  }

  async function deleteClassroom() {
    setDeletePending(true);
    setError(null);
    setMessage(null);
    try {
      await deleteJson<{ ok: true }>(classroomEndpoint(classroomId));
      router.push("/teacher");
      router.refresh();
    } catch (err) {
      setError(deleteErrorMessage(err));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Classroom settings</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-[var(--space-4)]">
        {isArchived ? (
          <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
            This classroom is archived. Unarchive it before renaming or assigning readings.
          </p>
        ) : (
          <TeacherFormShell
            onSubmit={renameClassroom}
            busy={renamePending}
            canSubmit={name.trim().length > 0 && name.trim() !== classroomName}
            submitLabel="Save name"
            busyLabel="Saving…"
          >
            <Field label="Classroom name">
              <Input
                value={name}
                maxLength={CLASSROOM_NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                aria-label="Classroom name"
              />
            </Field>
          </TeacherFormShell>
        )}

        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          {isArchived ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={archivePending}
              onClick={() => void setArchived(false)}
            >
              Unarchive classroom
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={archivePending}
              onClick={() => void setArchived(true)}
            >
              Archive classroom
            </Button>
          )}
          <ConfirmAction
            triggerLabel="Delete"
            triggerAriaLabel={`Delete classroom ${classroomName}`}
            triggerVariant="danger-ghost"
            confirmVariant="danger"
            confirmLabel="Confirm delete"
            confirmMessage={`Delete "${classroomName}"? Empty classrooms only can be deleted.`}
            onConfirm={deleteClassroom}
            loading={deletePending}
            disabled={deletePending}
          />
        </div>

        {message ? (
          <p role="status" className="m-0 text-[length:var(--text-sm)] text-text-muted">
            {message}
          </p>
        ) : null}
        {error ? <PanelError message={error} /> : null}
      </CardBody>
    </Card>
  );
}
