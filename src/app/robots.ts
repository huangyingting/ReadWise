import type { MetadataRoute } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Only the marketing homepage and sign-in page are publicly accessible.
        allow: ["/", "/signin"],
        // Disallow all auth-gated areas and backend routes.
        disallow: [
          "/api/",
          "/admin/",
          "/dashboard/",
          "/reader/",
          "/settings/",
          "/onboarding/",
          "/study/",
          "/tags/",
          "/browse/",
          "/lists/",
          "/forbidden/",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
