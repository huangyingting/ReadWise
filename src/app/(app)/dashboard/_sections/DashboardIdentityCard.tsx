/**
 * DashboardIdentityCard — displays the signed-in user's avatar, name, email,
 * and role badge (REF-059).
 */
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui";
import Avatar from "@/components/ui/Avatar";
import type { DashboardUser } from "@/app/(app)/dashboard/view-model";

interface DashboardIdentityCardProps {
  user: DashboardUser;
}

function RoleBadge({ role }: { role: DashboardUser["role"] }) {
  return (
    <Badge
      variant={role === "Admin" ? "primary" : "neutral"}
      className="mt-[var(--space-1)]"
    >
      {role}
    </Badge>
  );
}

export function DashboardIdentityCard({ user }: DashboardIdentityCardProps) {
  const displayName = user.name ?? "Unnamed reader";

  return (
    <Card>
      <div className="flex items-center gap-[var(--space-4)]">
        <Avatar src={user.image} name={user.name} size={56} />
        <div>
          <div className="font-semibold text-text">{displayName}</div>
          <div className="text-text-muted text-[length:var(--text-sm)]">{user.email}</div>
          <RoleBadge role={user.role} />
        </div>
      </div>
    </Card>
  );
}
