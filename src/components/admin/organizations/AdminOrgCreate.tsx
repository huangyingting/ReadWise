"use client";

import { useState } from "react";
import { postJson } from "@/lib/client-fetch";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAdminAction } from "@/hooks/useAdminAction";
import {
  adminOrganizationsEndpoint,
  createOrganizationBody,
} from "@/lib/admin/organizations/manage-ui";

/**
 * Client island: create an organization from the platform-admin surface (#1163).
 *
 * Posts `{ name, slug?, ownerUserId }` to `POST /api/admin/organizations`, which
 * reuses the existing tenant `createOrganization` + `addMember` commands to seed
 * the owner as the first OrgAdmin. On success it refreshes the server list.
 */
export default function AdminOrgCreate() {
  const { busy, error, run } = useAdminAction<"create">();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const creating = busy === "create";
  const canCreate = name.trim().length > 0 && ownerUserId.trim().length > 0;

  function submit() {
    return run(
      "create",
      async () => {
        await postJson(
          adminOrganizationsEndpoint(),
          createOrganizationBody({ name, slug, ownerUserId }),
        );
        setName("");
        setSlug("");
        setOwnerUserId("");
      },
      { errorFallback: "Could not create organization" },
    );
  }

  return (
    <Card className="stack">
      <h2 className="font-semibold text-[length:var(--text-lg)]">
        Create organization
      </h2>
      <div className="flex flex-wrap gap-[var(--space-2)]">
        <Input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Organization name"
          inputSize="md"
          className="flex-[1_1_200px]"
          aria-label="Organization name"
          disabled={creating}
        />
        <Input
          name="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="Slug (optional)"
          inputSize="md"
          className="flex-[1_1_160px]"
          aria-label="Organization slug (optional)"
          disabled={creating}
        />
        <Input
          name="ownerUserId"
          value={ownerUserId}
          onChange={(e) => setOwnerUserId(e.target.value)}
          placeholder="Owner user ID (first OrgAdmin)"
          inputSize="md"
          className="flex-[1_1_220px]"
          aria-label="Owner user ID"
          disabled={creating}
        />
        <Button
          type="button"
          variant="primary"
          size="md"
          className="w-auto"
          onClick={submit}
          disabled={!canCreate || creating}
          loading={creating}
        >
          Create
        </Button>
      </div>
      {error && (
        <p className="text-danger-text text-[length:var(--text-sm)] m-0">
          {error}
        </p>
      )}
    </Card>
  );
}
