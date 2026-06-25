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
 *
 * Shared form components (ListCreateForm, ListRenameForm, ListDeleteControl)
 * centralise mutation logic so desktop and mobile stay in sync. REF-007.
 */

import { useState, useRef, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X, MoreHorizontal } from "lucide-react";
import { cn, focusRing } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { ListRenameForm } from "@/components/lists/ListRenameForm";
import { ListCreateForm } from "@/components/lists/ListCreateForm";
import { ListDeleteControl } from "@/components/lists/ListDeleteControl";

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
      <ListRenameForm
        list={list}
        autoFocus
        className="px-[var(--space-2)] py-[var(--space-1)]"
        onSuccess={() => {
          setRenaming(false);
          onRenameSuccess();
        }}
        onCancel={() => setRenaming(false)}
      />
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

      {/* Rename + Delete — only for non-default lists */}
      {!list.isDefault ? (
        <div
          className={cn(
            "flex items-center gap-[var(--space-1)] shrink-0",
            "transition-opacity [transition-duration:var(--duration-fast)]",
          )}
        >
          <button
            type="button"
            aria-label={`Rename ${list.name}`}
            title="Rename list"
            onClick={() => setRenaming(true)}
            className={cn(
              "inline-flex items-center justify-center size-7 rounded-[var(--radius-sm)]",
              "text-text-subtle hover:text-text hover:bg-bg-subtle",
              "transition-colors [transition-duration:var(--duration-fast)]",
              focusRing,
            )}
          >
            <Pencil size={14} aria-hidden />
          </button>

          <ListDeleteControl
            listId={list.id}
            listName={list.name}
            confirmClassName="!p-0"
            onSuccess={() => onDeleteSuccess(list.id)}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Inline management panel for mobile — shown below the pill bar when a user
 * taps the ⋯ button on a custom (non-default) list.
 */
interface MobileListManagerProps {
  list: SwitcherList;
  onClose: () => void;
  onRenameSuccess: () => void;
  onDeleteSuccess: (deletedId: string) => void;
}

function MobileListManager({ list, onClose, onRenameSuccess, onDeleteSuccess }: MobileListManagerProps) {
  const [renaming, setRenaming] = useState(false);

  return (
    <div
      role="region"
      aria-label={`Manage ${list.name}`}
      className="mt-[var(--space-3)] p-[var(--space-3)] rounded-[var(--radius-md)] border border-border bg-bg-subtle flex flex-col gap-[var(--space-3)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <span className="text-[length:var(--text-sm)] font-semibold text-text truncate">
          {list.name}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cn(
            "inline-flex items-center justify-center size-7 shrink-0 rounded-[var(--radius-sm)]",
            "text-text-subtle hover:text-text hover:bg-surface",
            focusRing,
          )}
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {/* Rename */}
      {renaming ? (
        <ListRenameForm
          list={list}
          autoFocus
          onSuccess={() => {
            setRenaming(false);
            onRenameSuccess();
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          leadingIcon={<Pencil size={14} aria-hidden />}
          onClick={() => setRenaming(true)}
        >
          Rename
        </Button>
      )}

      {/* Delete */}
      <ListDeleteControl
        listId={list.id}
        listName={list.name}
        triggerLabel="Delete list"
        onSuccess={() => onDeleteSuccess(list.id)}
      />
    </div>
  );
}

export default function ListSwitcher({ lists, activeListId }: ListSwitcherProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [mobileManagingId, setMobileManagingId] = useState<string | null>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);

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
    setCreating(true);
    setMobileManagingId(null);
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
          <ListCreateForm
            onSuccess={(list) => {
              setCreating(false);
              router.push(`/lists?list=${encodeURIComponent(list.id)}`);
            }}
            onCancel={() => {
              setCreating(false);
              createBtnRef.current?.focus();
            }}
          />
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
        const isManaging = mobileManagingId === list.id;
        return (
          <Fragment key={list.id}>
            <Link
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
            {/* Per-list ⋯ manage button — only for non-default lists */}
            {!list.isDefault ? (
              <button
                type="button"
                aria-label={`Manage ${list.name}`}
                aria-expanded={isManaging}
                onClick={() => {
                  setCreating(false);
                  setMobileManagingId(isManaging ? null : list.id);
                }}
                className={cn(
                  "inline-flex items-center justify-center shrink-0 snap-start",
                  "h-9 w-8 rounded-[var(--radius-full)]",
                  "bg-surface border text-text-muted",
                  "transition-colors [transition-duration:var(--duration-fast)]",
                  isManaging
                    ? "border-border-strong bg-bg-subtle text-text"
                    : "border-border hover:border-border-strong hover:text-text hover:bg-bg-subtle",
                  focusRing,
                )}
              >
                <MoreHorizontal size={14} aria-hidden />
              </button>
            ) : null}
          </Fragment>
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
          <ListCreateForm
            className="mt-[var(--space-3)]"
            onSuccess={(list) => {
              setCreating(false);
              router.push(`/lists?list=${encodeURIComponent(list.id)}`);
            }}
            onCancel={() => setCreating(false)}
          />
        ) : null}
        {/* Mobile management panel — shown when ⋯ is tapped on a custom list */}
        {mobileManagingId && !creating ? (() => {
          const mgList = lists.find((l) => l.id === mobileManagingId && !l.isDefault);
          if (!mgList) return null;
          return (
            <MobileListManager
              key={mobileManagingId}
              list={mgList}
              onClose={() => setMobileManagingId(null)}
              onRenameSuccess={() => { setMobileManagingId(null); router.refresh(); }}
              onDeleteSuccess={(id) => {
                setMobileManagingId(null);
                if (id === activeListId) router.push("/lists");
                else router.refresh();
              }}
            />
          );
        })() : null}
      </div>
    </>
  );
}
