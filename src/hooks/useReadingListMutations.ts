"use client";

/**
 * useReadingListMutations — centralises create/rename/delete API calls for
 * reading lists so every call site uses the same network path and error
 * messages.
 *
 * Built on top of useMutation (REF-014) so busy + error state is managed
 * consistently.  The collections service on the server handles the actual
 * DB work via the /api/lists routes.
 */

import { useMutation } from "@/hooks/useMutation";
import { deleteJson, patchJson, postJson } from "@/lib/client-fetch";

export interface CreatedList {
  id: string;
  name: string;
  isDefault: boolean;
}

export function useReadingListMutations() {
  const createMut = useMutation("Couldn't create list — try again");
  const renameMut = useMutation("Couldn't rename — try again");
  const deleteMut = useMutation("Couldn't delete — try again");

  async function createList(name: string): Promise<CreatedList | undefined> {
    let created: CreatedList | undefined;
    await createMut.run(async () => {
      const data = await postJson<{ list: CreatedList }>("/api/lists", { name });
      created = data.list;
    });
    return created;
  }

  async function renameList(listId: string, name: string): Promise<boolean> {
    let succeeded = false;
    await renameMut.run(async () => {
      await patchJson(`/api/lists/${encodeURIComponent(listId)}`, { name });
      succeeded = true;
    });
    return succeeded;
  }

  async function deleteList(listId: string): Promise<boolean> {
    let succeeded = false;
    await deleteMut.run(async () => {
      await deleteJson(`/api/lists/${encodeURIComponent(listId)}`);
      succeeded = true;
    });
    return succeeded;
  }

  return {
    create: {
      run: createList,
      busy: createMut.busy,
      error: createMut.error,
      clearError: createMut.clearError,
    },
    rename: {
      run: renameList,
      busy: renameMut.busy,
      error: renameMut.error,
      clearError: renameMut.clearError,
    },
    delete: {
      run: deleteList,
      busy: deleteMut.busy,
      error: deleteMut.error,
      clearError: deleteMut.clearError,
    },
  };
}
