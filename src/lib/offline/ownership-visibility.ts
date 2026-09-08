export function shouldBlockOfflineView(
  actorId: string | null,
  durableActorId: string | null,
  accessBlocked: boolean,
): boolean {
  return (
    actorId !== null &&
    (accessBlocked || durableActorId !== actorId)
  );
}
