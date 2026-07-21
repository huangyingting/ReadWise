"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJson, patchJson } from "@/lib/client-fetch";
import {
  Button,
  Card,
  CardBody,
  PanelEmpty,
  PanelError,
  PanelLoading,
} from "@/components/ui";

type ClassroomListResponse = {
  classrooms: ArchivedClassroom[];
};

type ArchivedClassroom = {
  id: string;
  name: string;
  archivedAt: string | null;
};

const ARCHIVED_CLASSROOMS_ENDPOINT = "/api/classrooms?archived=true";
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

function classroomEndpoint(classroomId: string): string {
  return `/api/classrooms/${encodeURIComponent(classroomId)}`;
}

function archivedDateLabel(archivedAt: string | null): string {
  if (!archivedAt) return "Archived";
  const date = new Date(archivedAt);
  if (Number.isNaN(date.getTime())) return "Archived";
  return `Archived ${dateFormatter.format(date)}`;
}

export default function ArchivedClassroomsSection() {
  const router = useRouter();
  const [classrooms, setClassrooms] = useState<ArchivedClassroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const loadArchivedClassrooms = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await getJson<ClassroomListResponse>(ARCHIVED_CLASSROOMS_ENDPOINT);
        if (!isCancelled()) setClassrooms(data.classrooms ?? []);
      } catch {
        if (!isCancelled()) setLoadError("Archived classrooms couldn’t load.");
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void loadArchivedClassrooms(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadArchivedClassrooms]);

  async function unarchiveClassroom(classroomId: string) {
    setPendingId(classroomId);
    setActionError(null);
    try {
      await patchJson(classroomEndpoint(classroomId), { archived: false });
      setClassrooms((current) => current.filter((classroom) => classroom.id !== classroomId));
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn’t unarchive classroom.");
    } finally {
      setPendingId(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardBody>
          <PanelLoading message="Loading archived classrooms…" />
        </CardBody>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardBody className="flex flex-col gap-[var(--space-3)]">
          <PanelError message={loadError} />
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => void loadArchivedClassrooms()}>
              Retry
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (classrooms.length === 0) {
    return (
      <Card>
        <CardBody>
          <PanelEmpty
            title="No archived classrooms"
            description="Archived classes will appear here so you can restore them later."
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-[var(--space-4)]">
        {actionError ? <PanelError message={actionError} /> : null}
        <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0">
          {classrooms.map((classroom) => (
            <li
              key={classroom.id}
              className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-md)] border border-border p-[var(--space-3)] sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="m-0 font-medium text-text">{classroom.name}</p>
                <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
                  {archivedDateLabel(classroom.archivedAt)}
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={pendingId === classroom.id}
                onClick={() => void unarchiveClassroom(classroom.id)}
              >
                Unarchive
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
