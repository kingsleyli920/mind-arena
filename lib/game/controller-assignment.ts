export function isExternalController(controller: string): boolean {
  const normalized = controller.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "local";
}

export function findDuplicateModelIds<T extends string>(controllers: Record<T, string>, inactiveIds: readonly T[] = []): Set<string> {
  const inactive = new Set(inactiveIds);
  const counts = new Map<string, number>();
  for (const [factionId, value] of Object.entries<string>(controllers)) {
    if (inactive.has(factionId as T) || !isExternalController(value)) continue;
    const normalized = value.trim().toLowerCase();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
}

export function countExternalControllers<T extends string>(controllers: Record<T, string>, inactiveIds: readonly T[] = []): number {
  const inactive = new Set(inactiveIds);
  return Object.entries<string>(controllers).filter(([factionId, controller]) => !inactive.has(factionId as T) && isExternalController(controller)).length;
}
