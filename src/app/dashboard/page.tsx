import Link from "next/link";
import Image from "next/image";
import { requireSession } from "@/lib/session";
import SignOutButton from "@/components/SignOutButton";

export default async function DashboardPage() {
  const session = await requireSession("/dashboard");
  const user = session.user;

  return (
    <main className="container">
      <h1>Dashboard</h1>
      <div className="card stack" style={{ marginTop: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {user.image ? (
            <Image
              src={user.image}
              alt={user.name ?? "avatar"}
              width={56}
              height={56}
              style={{ borderRadius: "50%" }}
            />
          ) : null}
          <div>
            <div>
              <strong>{user.name ?? "Unnamed reader"}</strong>
            </div>
            <div className="muted">{user.email}</div>
            <div className="muted">Role: {user.role}</div>
          </div>
        </div>
      </div>
      {user.role === "Admin" ? (
        <p style={{ marginTop: "1.5rem" }}>
          <Link className="btn btn-primary" href="/admin">
            Admin dashboard
          </Link>
        </p>
      ) : null}
      <p style={{ marginTop: "1.5rem", display: "flex", gap: "1rem", alignItems: "center" }}>
        <Link href="/">← Back home</Link>
        <SignOutButton />
      </p>
    </main>
  );
}
