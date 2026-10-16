"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, MailPlus, Terminal, CheckCircle2, ArrowRight, Users } from "lucide-react";

type BootstrapStatus = {
  needsBootstrap: boolean;
  adminCount: number;
  admins: Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: string;
  }>;
  admissionMode: "invitation-only" | "public";
};

export default function ReadWiseBootstrapPage() {
  const router = useRouter();
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  async function refreshStatus() {
    try {
      const res = await fetch("/api/auth/bootstrap");
      const data = await res.json();
      if (res.ok) setStatus(data);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshStatus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim() || undefined,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not bootstrap administrator account.");
        return;
      }

      setSuccessMsg(`Administrator ${data.user.email} bootstrapped! Redirecting to /admin/invitations...`);
      await refreshStatus();
      router.push("/admin/invitations");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not bootstrap administrator account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 880, margin: "40px auto", padding: "0 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600 }}>
            <ShieldCheck size={16} />
            <span>Invite-Only Root Authority ({status?.admissionMode ?? "invitation-only"})</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>Bootstrap Administrator Account</h1>
        </div>
        <Link href="/admin/invitations" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <MailPlus size={15} /> Invitation Console
        </Link>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 8, marginBottom: 16, border: "1px solid #ef4444", color: "#ef4444" }}>
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{ padding: 12, borderRadius: 8, marginBottom: 16, border: "1px solid #10b981", color: "#10b981", display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle2 size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14, marginBottom: 28 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Administrator Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@readwise.local"
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #334155" }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Display Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ReadWise Admin"
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #334155" }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span>Password (min 12 chars)</span>
          <input
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #334155" }}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          style={{ padding: "10px 16px", borderRadius: 8, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          {loading ? "Bootstrapping..." : "Bootstrap Admin & Open Invitation Console"}
          <ArrowRight size={15} />
        </button>
      </form>

      <div style={{ borderTop: "1px solid #334155", paddingTop: 20, display: "grid", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <Users size={16} /> Active Administrators ({status?.adminCount ?? 0})
        </div>
        {status?.admins?.map((a) => (
          <div key={a.id} style={{ fontSize: 13 }}>
            <strong>{a.name}</strong> — <code>{a.email}</code> ({a.role})
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginTop: 8 }}>
          <Terminal size={16} /> CLI Bootstrap
        </div>
        <pre style={{ padding: 12, borderRadius: 8, background: "#0f172a", color: "#e2e8f0", fontSize: 12 }}>
{`printf '%s\\n' 'StrongPassword123!' | npm run bootstrap:admin -- --email admin@readwise.local --password-stdin`}
        </pre>
      </div>
    </div>
  );
}
