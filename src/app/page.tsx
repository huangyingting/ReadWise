import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import SignOutButton from "@/components/SignOutButton";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  return (
    <main className="container">
      <h1>ReadWise</h1>
      <p className="muted">
        AI-assisted English learning reader. Read cleaned news articles with
        on-demand translation, vocabulary, comprehension quizzes, and narration.
      </p>

      <div className="card stack" style={{ marginTop: "1.5rem" }}>
        {session?.user ? (
          <>
            <p>
              Signed in as <strong>{session.user.name ?? session.user.email}</strong>{" "}
              <span className="muted">({session.user.role})</span>
            </p>
            <Link className="btn btn-primary" href="/dashboard">
              Go to dashboard
            </Link>
            <Link className="btn" href="/browse">
              Browse articles
            </Link>
            <SignOutButton />
          </>
        ) : (
          <>
            <p>You are not signed in.</p>
            <Link className="btn btn-primary" href="/signin">
              Sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
