import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Archive, Check, Download, Eye, EyeOff, Trash2 } from "lucide-react";
import type { PackVisibility } from "@nest/shared";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { DeleteReleaseDialog } from "../components/DeleteReleaseDialog";
import { RegistryResyncNotice } from "../components/RegistryResyncNotice";
import { UserMultiPicker } from "../components/UserMultiPicker";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  RefreshButton,
  Select,
  Skeleton,
  buttonClass,
  formatDate,
} from "../components/ui";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { useAdminData, useRegistryResync } from "../lib/hooks";
import { PageHeader } from "../layout/PageHeader";

export function PackDetailPage() {
  const { packId } = useParams({ from: "/packs/$packId" });
  const navigate = useNavigate();
  const api = useApi();
  const qc = useQueryClient();
  const { packs, users } = useAdminData();
  const resync = useRegistryResync();
  const pack = packs.data?.find((item) => item.id === packId);
  const [deleteReleaseTarget, setDeleteReleaseTarget] = useState<{
    packName: string;
    version: string;
    isLast: boolean;
  } | null>(null);

  // Yank, access-grant, and maintainer actions — all POST-only endpoints.
  const releaseAndAccess = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) =>
      api(url, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
  });
  const update = useMutation({
    mutationFn: (body: { visibility?: PackVisibility; archived?: boolean }) =>
      api(`/api/admin/packs/${packId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
  });
  const removeRelease = useMutation({
    mutationFn: (target: { version: string; isLast: boolean }) =>
      api(`/api/admin/packs/${packId}/releases/${target.version}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, target) => {
      setDeleteReleaseTarget(null);
      void Promise.all([
        qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
        qc.invalidateQueries({ queryKey: adminQueryKeys.reviews }),
      ]);
      if (target.isLast) void navigate({ to: "/packs" });
    },
  });

  if (!pack)
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Knowledge packs", to: "/packs" },
            { label: packId },
          ]}
        />
        {packs.error && <ErrorBox error={packs.error} />}
        {packs.isLoading ? (
          <div className="space-y-5">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-4 w-96" />
            <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          </div>
        ) : (
          <Empty
            title="Pack not found"
            body={`No pack with id "${packId}" exists. It may have been deleted.`}
          />
        )}
      </>
    );
  const granted = new Set(pack.grants.map((user) => user.uuid));
  const grantableUsers = (users.data ?? []).filter(
    (user) => user.role === "user",
  );
  const maintainerUuids = new Set(pack.maintainers.map((user) => user.uuid));
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Knowledge packs", to: "/packs" },
          { label: pack.name },
        ]}
      />
      <PageHeader
        eyebrow="Knowledge pack"
        title={pack.name}
        description={`${pack.id} · ${pack.releases.length} published release${pack.releases.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RefreshButton
              onClick={() => resync.mutate()}
              busy={resync.isPending || packs.isFetching}
              label="Resync with registry folder"
            />
            {pack.latest_version && (
              <a
                href={`/api/admin/packs/${encodeURIComponent(pack.id)}/releases/${encodeURIComponent(pack.latest_version)}/download`}
                download
                className={buttonClass("outline")}
              >
                <Download />
                Download v{pack.latest_version}
              </a>
            )}
            <Button
              variant="outline"
              disabled={update.isPending}
              onClick={() => update.mutate({ archived: !pack.archived })}
            >
              <Archive />
              {pack.archived ? "Restore pack" : "Archive pack"}
            </Button>
          </div>
        }
      />
      {(releaseAndAccess.error ||
        update.error ||
        removeRelease.error ||
        resync.error) && (
        <ErrorBox
          error={
            releaseAndAccess.error ||
            update.error ||
            removeRelease.error ||
            resync.error
          }
        />
      )}
      <RegistryResyncNotice result={resync.data} />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  Published versions
                </h2>
                <p className="text-sm text-muted-foreground">
                  Yank a release to remove it from discovery without deleting
                  its history.
                </p>
              </div>
              <Badge tone={pack.archived ? "stone" : "green"}>
                {pack.archived ? <Archive /> : <Check />}
                {pack.archived ? "Archived" : "Active"}
              </Badge>
            </div>
            <div className="mt-5 divide-y divide-border">
              {pack.releases.map((release) => (
                <div
                  key={release.version}
                  className="flex flex-wrap items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm font-medium">
                        v{release.version}
                      </p>
                      {release.version === pack.latest_version ? (
                        <Badge tone="green">Latest</Badge>
                      ) : release.yanked ? (
                        <Badge tone="amber">Yanked</Badge>
                      ) : (
                        <Badge tone="stone">Available</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Published {formatDate(release.published_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <a
                      href={`/api/admin/packs/${encodeURIComponent(pack.id)}/releases/${encodeURIComponent(release.version)}/download`}
                      download
                      className={buttonClass("outline", "sm")}
                    >
                      <Download />
                      Download
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={releaseAndAccess.isPending}
                      onClick={() =>
                        releaseAndAccess.mutate({
                          url: `/api/admin/packs/${pack.id}/releases/${release.version}/yank`,
                          body: { yanked: !release.yanked },
                        })
                      }
                    >
                      {release.yanked ? <Eye /> : <EyeOff />}
                      {release.yanked ? "Restore" : "Yank"}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={removeRelease.isPending}
                      onClick={() =>
                        setDeleteReleaseTarget({
                          packName: pack.name,
                          version: release.version,
                          isLast: pack.releases.length === 1,
                        })
                      }
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="text-xl font-semibold tracking-tight">
              Description
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {pack.description || "No description provided."}
            </p>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <h2 className="text-xl font-semibold tracking-tight">
              Access &amp; permissions
            </h2>
            <div className="mt-4 space-y-4">
              <Field label="Visibility">
                <Select
                  value={pack.visibility}
                  onValueChange={(value) =>
                    update.mutate({ visibility: value as PackVisibility })
                  }
                  options={[
                    { value: "public", label: "Public — visible to everyone" },
                    {
                      value: "restricted",
                      label: "Restricted — selected users only",
                    },
                  ]}
                />
              </Field>
              <Field label="Maintainers">
                <UserMultiPicker
                  users={users.data ?? []}
                  selectedUuids={[...maintainerUuids]}
                  onChange={(nextUuids) => {
                    const next = new Set(nextUuids);
                    for (const uuid of next)
                      if (!maintainerUuids.has(uuid))
                        releaseAndAccess.mutate({
                          url: `/api/admin/packs/${pack.id}/maintainers/${uuid}`,
                          body: { allowed: true },
                        });
                    for (const uuid of maintainerUuids)
                      if (!next.has(uuid))
                        releaseAndAccess.mutate({
                          url: `/api/admin/packs/${pack.id}/maintainers/${uuid}`,
                          body: { allowed: false },
                        });
                  }}
                  placeholder="Search users to add as a maintainer…"
                  emptyHint="No user accounts exist yet."
                />
              </Field>
            </div>
          </Card>
          <Card>
            <h2 className="text-xl font-semibold tracking-tight">
              Allowed users
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Only selected users and administrators can access a restricted
              pack.
            </p>
            {pack.visibility === "public" ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
                This pack is <strong className="text-foreground">public</strong>{" "}
                — every signed-in user can already access it, so individual
                grants don't apply. Set Visibility above to{" "}
                <strong className="text-foreground">Restricted</strong> to
                manage per-user access.
              </div>
            ) : grantableUsers.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
                No regular user accounts exist yet — grants only apply to
                accounts with the "User" role (see{" "}
                <Link
                  to="/users"
                  className="font-medium text-primary hover:underline"
                >
                  User access
                </Link>
                ). Admins and superusers already have access to every pack.
              </div>
            ) : (
              <div className="mt-4">
                <UserMultiPicker
                  users={grantableUsers}
                  selectedUuids={[...granted]}
                  onChange={(nextUuids) => {
                    const next = new Set(nextUuids);
                    for (const uuid of next)
                      if (!granted.has(uuid))
                        releaseAndAccess.mutate({
                          url: `/api/admin/packs/${pack.id}/access/${uuid}`,
                          body: { allowed: true },
                        });
                    for (const uuid of granted)
                      if (!next.has(uuid))
                        releaseAndAccess.mutate({
                          url: `/api/admin/packs/${pack.id}/access/${uuid}`,
                          body: { allowed: false },
                        });
                  }}
                  placeholder="Search users to grant access…"
                />
              </div>
            )}
          </Card>
        </div>
      </div>
      <DeleteReleaseDialog
        target={deleteReleaseTarget}
        onOpenChange={(open) => !open && setDeleteReleaseTarget(null)}
        busy={removeRelease.isPending}
        onConfirm={() =>
          deleteReleaseTarget && removeRelease.mutate(deleteReleaseTarget)
        }
      />
    </>
  );
}
