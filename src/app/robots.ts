import type { MetadataRoute } from "next";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

const PUBLIC_ROBOT_ALLOW = ["/", "/signin"];
const PRIVATE_ROBOT_DISALLOW = [
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
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Only the marketing homepage and sign-in page are publicly accessible.
        allow: PUBLIC_ROBOT_ALLOW,
        // Disallow all auth-gated areas and backend routes.
        disallow: PRIVATE_ROBOT_DISALLOW,
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
