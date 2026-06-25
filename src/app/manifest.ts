import type { MetadataRoute } from "next";
import { SITE_NAME, MANIFEST_DESCRIPTION } from "@/lib/copy/site";
import { ICON_SVG, ICON_192, ICON_512 } from "@/lib/assets";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: MANIFEST_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    // Brand primary color from tokens.css: --primary: #4f46e5
    theme_color: "#4f46e5",
    background_color: "#ffffff",
    icons: [
      {
        src: ICON_SVG,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: ICON_192,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: ICON_512,
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: ICON_512,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
