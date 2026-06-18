import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="container">
      <h1>403 — Forbidden</h1>
      <p className="muted">
        You don&apos;t have permission to access this area. Admin access is
        required.
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/">← Back home</Link>
      </p>
    </main>
  );
}
