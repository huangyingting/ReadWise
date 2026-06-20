import type { Metadata } from "next";
import { Inter, Space_Grotesk, Literata } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import ClientErrorReporter from "@/components/ClientErrorReporter";

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans-src",
  display: "swap",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display-src",
  display: "swap",
});

const reading = Literata({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-reading-src",
  display: "swap",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXTAUTH_URL ??
  "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    template: "%s | ReadWise",
    default: "ReadWise — AI-Assisted English Learning Reader",
  },
  description:
    "Read cleaned news articles with on-demand AI translation, vocabulary, quizzes, narration, and CEFR leveling. Learn English from real news.",
  openGraph: {
    type: "website",
    siteName: "ReadWise",
    title: "ReadWise — AI-Assisted English Learning Reader",
    description:
      "Read cleaned news articles with on-demand AI translation, vocabulary, quizzes, and narration. Improve your English with real news.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ReadWise — AI-Assisted English Learning Reader",
    description:
      "Read cleaned news articles with on-demand AI translation, vocabulary, quizzes, and narration. Improve your English with real news.",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

// Blocking, pre-paint theme resolution to avoid a light/dark flash (FOUC) and
// to guarantee an explicit data-theme attribute exists before hydration.
const themeScript = `(function(){try{var t=localStorage.getItem("readwise:theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${reading.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ClientErrorReporter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
