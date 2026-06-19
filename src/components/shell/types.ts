import type { Role } from "@prisma/client";

/** Minimal, display-only user shape passed from the server layout to the shell. */
export interface ShellUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: Role;
}
