import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import ClientErrorReporter from "@/components/ClientErrorReporter";

export const metadata: Metadata = {
  title: "ReadWise — AI-Assisted English Learning Reader",
  description:
    "Read cleaned news articles with on-demand AI translation, vocabulary, quizzes, and narration.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ClientErrorReporter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
