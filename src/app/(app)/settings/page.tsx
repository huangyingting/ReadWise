import Image from "next/image";
import { requireOnboardedSession } from "@/lib/session";
import { getProfile, parseTopics } from "@/lib/profile";
import ProfileSettingsForm from "./ProfileSettingsForm";

export const metadata = {
  title: "Settings — ReadWise",
};

export default async function SettingsPage() {
  const session = await requireOnboardedSession("/settings");
  const user = session.user;
  const profile = await getProfile(user.id);

  return (
    <main className="container">
      <h1>Settings</h1>

      <section className="card stack" style={{ marginTop: "1.5rem" }}>
        <h2 style={{ margin: 0 }}>Account</h2>
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
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Learning preferences</h2>
        <p className="muted">
          These shape the articles and recommendations we surface for you.
        </p>
        <ProfileSettingsForm
          defaults={{
            ageRange: profile?.ageRange ?? "",
            gender: profile?.gender ?? "",
            englishLevel: profile?.englishLevel ?? "",
            topics: parseTopics(profile?.topics),
          }}
        />
      </section>
    </main>
  );
}
