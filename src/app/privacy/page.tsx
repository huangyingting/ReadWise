import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "ReadWise Privacy Policy — how we collect, use, and protect your data.",
};

export default function PrivacyPage() {
  return (
    <main className="container" style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1
        className="font-[family-name:var(--font-display)] font-bold text-[length:var(--text-3xl)] text-text"
        style={{ marginBottom: "0.5rem" }}
      >
        Privacy Policy
      </h1>
      <p className="text-text-subtle text-[length:var(--text-sm)]" style={{ marginBottom: "2rem" }}>
        Last updated: June 2025
      </p>

      <div className="stack">
        <section>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
            1. What we collect
          </h2>
          <p className="text-text-muted">
            ReadWise collects information you provide directly (name, email address) via OAuth sign-in
            providers such as Google and GitHub. We also store your reading progress, saved vocabulary
            words, highlight notes, and onboarding preferences (English level, topics of interest, age
            range, and gender — the latter two are optional).
          </p>
        </section>

        <section>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
            2. How we use your data
          </h2>
          <p className="text-text-muted">
            Your data is used solely to provide and improve the ReadWise service — personalising your
            article feed, tracking reading progress, powering vocabulary and quiz features, and
            maintaining your study list. We do not sell or share your personal information with third
            parties for advertising.
          </p>
        </section>

        <section>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
            3. Third-party services
          </h2>
          <p className="text-text-muted">
            We use Azure OpenAI and Azure Cognitive Services (Speech) to generate article translations,
            vocabulary, quizzes, and narration. Article text may be sent to these services for
            processing. We use OAuth providers (Google, GitHub) for authentication — please review
            their privacy policies for how they handle your sign-in data.
          </p>
        </section>

        <section>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
            4. Data retention &amp; deletion
          </h2>
          <p className="text-text-muted">
            You can permanently delete your account and all associated data at any time from{" "}
            <Link href="/settings" className="text-primary-text hover:underline">
              Settings → Privacy &amp; account
            </Link>
            . When an account is deleted, all reading progress, saved words, highlights,
            and profile information are permanently and immediately removed.
          </p>
        </section>

        <section>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
            5. Cookies &amp; local storage
          </h2>
          <p className="text-text-muted">
            ReadWise uses a session cookie (<code>next-auth.session-token</code>) to maintain your
            signed-in state. We use <code>localStorage</code> to persist your reading preferences
            (font size, reading mode, theme) on your device. No third-party tracking cookies are used.
          </p>
        </section>

        <section>
          <h2 className="font-[family-name:var(--font-display)] font-semibold text-[length:var(--text-xl)] text-text">
            6. Contact
          </h2>
          <p className="text-text-muted">
            For privacy questions or data requests, please contact the ReadWise team via GitHub Issues.
          </p>
        </section>
      </div>

      <p style={{ marginTop: "2rem" }}>
        <Link href="/" className="text-primary-text hover:underline">
          ← Back to ReadWise
        </Link>
      </p>
    </main>
  );
}
