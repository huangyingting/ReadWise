import { NextResponse } from "next/server";
import { createHandler } from "@/lib/api-handler";
import { object, string, optional } from "@/lib/validation";
import { createOrganization } from "@/lib/org";

const createOrgBody = object({
  name: string({ min: 1, max: 120 }),
  slug: optional(string({ min: 1, max: 120 })),
});

/**
 * Creates an organization (RW-060). Any authenticated user may create one and
 * becomes its first OrgAdmin. This is additive: a user with no org keeps the
 * exact global single-user experience.
 */
export const POST = createHandler(
  { body: createOrgBody },
  async ({ body, session }) => {
    const { organization, membership } = await createOrganization(
      { name: body.name, slug: body.slug },
      session.user.id,
    );
    return NextResponse.json({ organization, membership }, { status: 201 });
  },
);
