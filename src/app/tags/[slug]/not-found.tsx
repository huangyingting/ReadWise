import Link from "next/link";

export default function TagNotFound() {
  return (
    <main className="container">
      <h1>Tag not found</h1>
      <p className="muted">
        We couldn&apos;t find that tag. It may not exist yet or the link is
        incorrect.
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <Link className="btn btn-primary" href="/dashboard">
          Back to dashboard
        </Link>
      </p>
    </main>
  );
}
