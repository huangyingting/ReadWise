import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import SignInButtons from "./SignInButtons";

export const metadata = {
  title: "Sign in — ReadWise",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/dashboard";

  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(safeCallback);
  }

  const providers = (authOptions.providers ?? []).map((p) => ({
    id: p.id,
    name: p.name,
  }));

  return (
    <main className="container">
      <h1>Sign in to ReadWise</h1>
      <p className="muted">Choose a provider to continue.</p>
      <div className="card" style={{ marginTop: "1.5rem", maxWidth: 420 }}>
        <SignInButtons providers={providers} callbackUrl={safeCallback} />
      </div>
    </main>
  );
}
