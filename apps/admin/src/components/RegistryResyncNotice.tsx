import type { RegistryResyncResult } from "@nest/shared";

export function RegistryResyncNotice({
  result,
}: {
  result: RegistryResyncResult | undefined;
}) {
  if (!result) return null;
  const added = result.packs_added.length + result.releases_added.length;
  const updated = result.packs_updated.length + result.releases_updated.length;
  const removed = result.packs_removed.length + result.releases_removed.length;
  const changed = added + updated + removed;
  const hasIssues = result.issues.length > 0;

  return (
    <div
      className={
        hasIssues
          ? "mb-5 rounded-lg border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          : "mb-5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground"
      }
      role="status"
      aria-live="polite"
    >
      <p className="font-medium">
        {changed === 0
          ? "Registry and database are in sync."
          : `Registry synchronized: ${added} added, ${updated} updated, ${removed} removed.`}
      </p>
      {hasIssues && (
        <>
          <p className="mt-1 text-xs">
            {result.issues.length} registry{" "}
            {result.issues.length === 1 ? "entry needs" : "entries need"}{" "}
            attention. Existing database records were preserved for invalid
            entries.
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
            {result.issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                <span className="font-mono font-medium">{issue.path}</span>:{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
