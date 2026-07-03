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

const LISTS_API_PATH = "/api/lists";

export interface CreatedList {
  id: string;
  name: string;
  isDefault: boolean;
}

function listApiPath(listId: string): string {
  return `${LISTS_API_PATH}/${encodeURIComponent(listId)}`;
}

export function useReadingListMutations() {
  const createMut = useMutation("Couldn't create list — try again");
  const renameMut = useMutation("Couldn't rename — try again");
  const deleteMut = useMutation("Couldn't delete — try again");

  async function createList(name: string): Promise<CreatedList | undefined> {
    const data = await createMut.run(() =>
      postJson<{ list: CreatedList }>(LISTS_API_PATH, { name }),
    );
    return data?.list;
  }

  async function renameList(listId: string, name: string): Promise<boolean> {
    const succeeded = await renameMut.run(async () => {
      await patchJson(listApiPath(listId), { name });
      return true;
    });
    return succeeded ?? false;
  }

  async function deleteList(listId: string): Promise<boolean> {
    const succeeded = await deleteMut.run(async () => {
      await deleteJson(listApiPath(listId));
      return true;
    });
    return succeeded ?? false;
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
