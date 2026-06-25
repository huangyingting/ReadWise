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

export function DashboardIdentityCard({ user }: DashboardIdentityCardProps) {
  return (
    <Card>
      <div className="flex items-center gap-[var(--space-4)]">
        <Avatar src={user.image} name={user.name} size={56} />
        <div>
          <div className="font-semibold text-text">{user.name ?? "Unnamed reader"}</div>
          <div className="text-text-muted text-[length:var(--text-sm)]">{user.email}</div>
          <Badge
            variant={user.role === "Admin" ? "primary" : "neutral"}
            className="mt-[var(--space-1)]"
          >
            {user.role}
          </Badge>
        </div>
      </div>
    </Card>
  );
}
