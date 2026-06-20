"use client";

/**
 * ListSwitcher — M10 reading-list tab switcher for the /lists page.
 *
 * Desktop (≥900px): vertical sidebar with list buttons + management controls.
 * Mobile (<900px):  horizontal snap-scroll pill bar (mirrors CategoryBrowser).
 *
 * List management:
 *   - Inline "New list" creation (Enter submit / Escape cancel)
 *   - Inline rename (Pencil trigger → Input → Enter/Escape)
 *   - Delete via M8 ConfirmAction (default list omits rename + delete)
 *
 * After any mutation, calls router.refresh() so the server component re-fetches
 * the updated list and article data.
 */

import { useState, useRef, useId } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import ConfirmAction from "@/components/ConfirmAction";

export type SwitcherList = {
  id: string;
  name: string;
  isDefault: boolean;
  count: number;
};

interface ListSwitcherProps {
  lists: SwitcherList[];
  activeListId: string | null;
}

function Badge({ count }: { count: number }) {
  return (
    <span className="ml-auto shrink-0 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-[var(--radius-full)] bg-bg-subtle border border-border text-[length:var(--text-xs)] text-text-muted font-medium">
      {count}
    </span>
  );
}

interface ListRowProps {
  list: SwitcherList;
  isActive: boolean;
  onRenameSuccess: () => void;
  onDeleteSuccess: (deletedId: string) => void;
}

function ListRow({ list, isActive, onRenameSuccess, onDeleteSuccess }: ListRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(list.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  function startRename() {
    setRenameValue(list.name);
    setRenameError(null);
    setRenaming(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function submitRename(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Name is required");
      return;
    }
    if (trimmed.length > 60) {
      setRenameError("Must be 60 characters or less");
      return;
    }
    if (trimmed === list.name) {
      setRenaming(false);
      return;
    }
    setRenamePending(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/lists/${encodeURIComponent(list.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Failed");
      setRenaming(false);
      onRenameSuccess();
    } catch {
      setRenameError("Couldn't rename — try again");
    } finally {
      setRenamePending(false);
    }
  }

  async function handleDelete() {
    setDeletePending(true);
    try {
      const res = await fetch(`/api/lists/${encodeURIComponent(list.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
      onDeleteSuccess(list.id);
    } finally {
      setDeletePending(false);
    }
  }

  const activeClasses = cn(
    "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-text",
    "border-l-2 border-primary",
  );
  const inactiveClasses = cn(
    "text-text-muted hover:bg-bg-subtle hover:text-text",
    "border-l-2 border-transparent",
  );

  if (renaming) {
    return (
      <form
        onSubmit={(e) => void submitRename(e)}
        className="flex flex-col gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)]"
      >
        <Input
          ref={inputRef}
          inputSize="sm"
          value={renameValue}
          maxLength={60}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setRenaming(false);
            }
          }}
          aria-label={`Rename ${list.name}`}
          aria-describedby={renameError ? errorId : undefined}
          invalid={renameError ? true : false}
        />
        {renameError ? (
          <p id={errorId} className="text-[length:var(--text-xs)] text-danger-text m-0">
            {renameError}
          </p>
        ) : null}
        <div className="flex gap-[var(--space-1)]">
          <Button
            type="submit"
            size="sm"
            variant="primary"
            loading={renamePending}
            disabled={!renameValue.trim()}
            leadingIcon={<Check size={12} aria-hidden />}
          >
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={renamePending}
            onClick={() => setRenaming(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="group/list-row flex items-center gap-[var(--space-1)]">
      <Link
        href={list.isDefault ? "/lists" : `/lists?list=${encodeURIComponent(list.id)}`}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-[var(--space-2)] flex-1 min-w-0",
          "px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)]",
          "text-[length:var(--text-sm)] font-medium no-underline",
          "transition-colors [transition-duration:var(--duration-fast)]",
          isActive ? activeClasses : inactiveClasses,
          focusRing,
        )}
      >
        <span className="truncate flex-1">{list.name}</span>
        {list.isDefault ? (
          <span className="text-[length:var(--text-xs)] text-text-subtle shrink-0">
            (default)
          </span>
        ) : (
          <Badge count={list.count} />
        )}
      </Link>

      {/* Rename + Delete — only for non-default lists, revealed on hover/focus */}
      {!list.isDefault ? (
        <div
          className={cn(
            "flex items-center gap-[var(--space-1)] shrink-0",
            "opacity-0 group-hover/list-row:opacity-100 focus-within:opacity-100",
            "transition-opacity [transition-duration:var(--duration-fast)]",
          )}
        >
          <button
            type="button"
            aria-label={`Rename ${list.name}`}
            title="Rename list"
            onClick={startRename}
            className={cn(
              "inline-flex items-center justify-center size-7 rounded-[var(--radius-sm)]",
              "text-text-subtle hover:text-text hover:bg-bg-subtle",
              "transition-colors [transition-duration:var(--duration-fast)]",
              focusRing,
            )}
          >
            <Pencil size={14} aria-hidden />
          </button>

          <ConfirmAction
            triggerLabel={`Delete`}
            triggerVariant="outline"
            size="sm"
            confirmMessage={`Delete "${list.name}"? Saved articles stay in your library; only this list is removed.`}
            confirmLabel="Delete"
            cancelLabel="Keep"
            confirmVariant="danger"
            loading={deletePending}
            onConfirm={handleDelete}
            className="!p-0"
          />
        </div>
      ) : null}
    </div>
  );
}

export default function ListSwitcher({ lists, activeListId }: ListSwitcherProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const errorId = useId();

  function handleRenameSuccess() {
    router.refresh();
  }

  function handleDeleteSuccess(deletedId: string) {
    // If we deleted the active list, go to the default (/lists)
    if (deletedId === activeListId) {
      router.push("/lists");
    } else {
      router.refresh();
    }
  }

  function showCreate() {
    setNewListName("");
    setCreateError(null);
    setCreating(true);
    setTimeout(() => createInputRef.current?.focus(), 0);
  }

  async function handleCreate(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = newListName.trim();
    if (!trimmed) {
      setCreateError("Name is required");
      return;
    }
    if (trimmed.length > 60) {
      setCreateError("Must be 60 characters or less");
      return;
    }
    setCreatePending(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { list: { id: string } };
      setCreating(false);
      setNewListName("");
      // Navigate to new list
      router.push(`/lists?list=${encodeURIComponent(data.list.id)}`);
    } catch {
      setCreateError("Couldn't create list — try again");
    } finally {
      setCreatePending(false);
    }
  }

  // --- Desktop sidebar ---
  const sidebarContent = (
    <>
      <nav
        role="tablist"
        aria-label="Reading lists"
        aria-orientation="vertical"
        className="flex flex-col gap-[var(--space-1)]"
      >
        {lists.map((list) => (
          <div key={list.id} role="tab" aria-selected={list.id === activeListId || (!activeListId && list.isDefault)}>
            <ListRow
              list={list}
              isActive={list.id === activeListId || (!activeListId && list.isDefault)}
              onRenameSuccess={handleRenameSuccess}
              onDeleteSuccess={handleDeleteSuccess}
            />
          </div>
        ))}
      </nav>

      {/* Create new list */}
      <div className="mt-[var(--space-2)]">
        {creating ? (
          <form
            onSubmit={(e) => void handleCreate(e)}
            className="flex flex-col gap-[var(--space-1)]"
          >
            <Input
              ref={createInputRef}
              inputSize="sm"
              placeholder="List name…"
              value={newListName}
              maxLength={60}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  createBtnRef.current?.focus();
                }
              }}
              aria-label="New list name"
              aria-describedby={createError ? errorId : undefined}
              invalid={createError ? true : false}
            />
            {createError ? (
              <p id={errorId} className="text-[length:var(--text-xs)] text-danger-text m-0">
                {createError}
              </p>
            ) : null}
            <div className="flex gap-[var(--space-1)]">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                loading={createPending}
                disabled={!newListName.trim()}
                leadingIcon={<Check size={12} aria-hidden />}
              >
                Create
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={createPending}
                onClick={() => {
                  setCreating(false);
                  createBtnRef.current?.focus();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <button
            ref={createBtnRef}
            type="button"
            onClick={showCreate}
            className={cn(
              "flex items-center gap-[var(--space-2)] w-full",
              "px-[var(--space-3)] py-[var(--space-2)] rounded-[var(--radius-md)]",
              "text-[length:var(--text-sm)] text-text-muted hover:bg-bg-subtle hover:text-text",
              "border-l-2 border-transparent",
              "transition-colors [transition-duration:var(--duration-fast)]",
              focusRing,
            )}
          >
            <Plus size={16} aria-hidden />
            New list
          </button>
        )}
      </div>
    </>
  );

  // --- Mobile pill bar ---
  const pillBar = (
    <nav
      className="lists-mobile-switcher flex flex-nowrap overflow-x-auto items-center gap-[var(--space-2)] pb-[var(--space-1)]"
      style={{ scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}
      aria-label="Reading lists"
    >
      {lists.map((list) => {
        const isActive = list.id === activeListId || (!activeListId && list.isDefault);
        return (
          <Link
            key={list.id}
            href={list.isDefault ? "/lists" : `/lists?list=${encodeURIComponent(list.id)}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-[var(--space-1)] shrink-0 snap-start",
              "h-9 px-[var(--space-4)]",
              "rounded-[var(--radius-full)]",
              "text-[length:var(--text-sm)] font-medium no-underline",
              "transition-colors [transition-duration:var(--duration-fast)]",
              isActive
                ? "bg-primary border border-primary text-on-primary"
                : "bg-surface border border-border text-text-muted hover:border-border-strong hover:text-text hover:bg-bg-subtle",
              focusRing,
            )}
          >
            {list.name}
            <Badge count={list.count} />
          </Link>
        );
      })}

      {/* New list pill */}
      <button
        type="button"
        onClick={showCreate}
        className={cn(
          "inline-flex items-center gap-[var(--space-1)] shrink-0 snap-start",
          "h-9 px-[var(--space-3)]",
          "rounded-[var(--radius-full)]",
          "text-[length:var(--text-sm)] font-medium",
          "bg-surface border border-dashed border-border text-text-muted",
          "hover:border-border-strong hover:text-text hover:bg-bg-subtle",
          "transition-colors [transition-duration:var(--duration-fast)]",
          focusRing,
        )}
      >
        <Plus size={14} aria-hidden />
        <span className="hidden sm:inline">New list</span>
      </button>
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="lists-sidebar hidden">
        {sidebarContent}
      </aside>

      {/* Mobile pill bar */}
      <div className="lists-mobile-bar">
        {pillBar}
        {/* Mobile create form (shown below bar when creating) */}
        {creating ? (
          <form
            onSubmit={(e) => void handleCreate(e)}
            className="mt-[var(--space-3)] flex flex-col gap-[var(--space-2)]"
          >
            <Input
              ref={createInputRef}
              inputSize="sm"
              placeholder="List name…"
              value={newListName}
              maxLength={60}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                }
              }}
              aria-label="New list name"
              invalid={createError ? true : false}
            />
            {createError ? (
              <p className="text-[length:var(--text-xs)] text-danger-text m-0">{createError}</p>
            ) : null}
            <div className="flex gap-[var(--space-2)]">
              <Button type="submit" size="sm" variant="primary" loading={createPending} disabled={!newListName.trim()}>
                Create
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={createPending} onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </>
  );
}
