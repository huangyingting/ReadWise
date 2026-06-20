import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ReadWise",
    short_name: "ReadWise",
    description:
      "AI-assisted English learning reader with real news articles, CEFR leveling, translation, vocabulary, and narration.",
    start_url: "/",
    display: "standalone",
    // Brand primary color from tokens.css: --primary: #4f46e5
    theme_color: "#4f46e5",
    background_color: "#ffffff",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
