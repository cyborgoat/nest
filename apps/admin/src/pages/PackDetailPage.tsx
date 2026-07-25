import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Archive, Check, Eye, EyeOff, Trash2 } from "lucide-react";
import type { PackVisibility } from "@nest/shared";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { PackActionsMenu } from "../components/PackActionsMenu";
import { UserMultiPicker } from "../components/UserMultiPicker";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  RefreshButton,
  Select,
  Skeleton,
  formatDate,
} from "../components/ui";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { useAdminData } from "../lib/hooks";
import { PageHeader } from "../layout/PageHeader";

export function PackDetailPage() {
  const { packId } = useParams({ from: "/packs/$packId" });
  const navigate = useNavigate();
  const api = useApi();
  const qc = useQueryClient();
  const { packs, users } = useAdminData();
  const pack = packs.data?.find((item) => item.id === packId);
  const [deleteTarget, setDeleteTarget] = useState<
    NonNullable<typeof pack> | null
  >(null);

  // Yank + access-grant actions — both are POST-only endpoints.
  const releaseAndAccess = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) =>
      api(url, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
  });
  const update = useMutation({
    mutationFn: (body: { visibility?: PackVisibility; owner_id?: string | null }) =>
      api(`/api/admin/packs/${packId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/api/admin/packs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteTarget(null);
      void Promise.all([
        qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
        qc.invalidateQueries({ queryKey: adminQueryKeys.reviews }),
      ]);
      void navigate({ to: "/packs" });
    },
  });

  if (!pack)
    return (
      <>
        <Breadcrumbs
          items={[{ label: "Knowledge packs", to: "/packs" }, { label: packId }]}
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
  return (
    <>
      <Breadcrumbs
        items={[{ label: "Knowledge packs", to: "/packs" }, { label: pack.name }]}
      />
      <PageHeader
        eyebrow="Knowledge pack"
        title={pack.name}
        description={`${pack.id} · ${pack.releases.length} published release${pack.releases.length === 1 ? "" : "s"}`}
        actions={
          <div className="flex items-center gap-2">
            <RefreshButton
              onClick={() =>
                qc.invalidateQueries({ queryKey: adminQueryKeys.packs })
              }
              busy={packs.isFetching}
            />
            <PackActionsMenu
              pack={pack}
              hideViewDetails
              onDeleteRequest={setDeleteTarget}
              triggerLabel="Pack actions"
            />
          </div>
        }
      />
      {(releaseAndAccess.error || update.error || remove.error) && (
        <ErrorBox
          error={releaseAndAccess.error || update.error || remove.error}
        />
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl">Published versions</h2>
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
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="font-mono text-sm font-medium">
                      v{release.version}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Published {formatDate(release.published_at)}
                    </p>
                  </div>
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
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <h2 className="font-serif text-xl">Description</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {pack.description || "No description provided."}
            </p>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <h2 className="font-serif text-xl">Access &amp; permissions</h2>
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
              <Field label="Maintainer">
                <UserMultiPicker
                  users={users.data ?? []}
                  selectedUuids={pack.owner_uuid ? [pack.owner_uuid] : []}
                  onChange={(uuids) => {
                    const loginId = uuids[0]
                      ? (users.data ?? []).find((u) => u.uuid === uuids[0])?.id ??
                        null
                      : null;
                    update.mutate({ owner_id: loginId });
                  }}
                  max={1}
                  placeholder="Search users to assign a maintainer…"
                />
              </Field>
            </div>
          </Card>
          <Card>
            <h2 className="font-serif text-xl">Allowed users</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Only selected users and administrators can access a restricted
              pack.
            </p>
            {pack.visibility === "public" ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
                This pack is{" "}
                <strong className="text-foreground">public</strong> — every
                signed-in user can already access it, so individual grants
                don't apply. Set Visibility above to{" "}
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
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete knowledge pack"
        description={`Permanently delete ${deleteTarget?.name ?? "this pack"} and all published releases.`}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          This removes the registry files, {deleteTarget?.releases.length ?? 0}{" "}
          published release
          {(deleteTarget?.releases.length ?? 0) === 1 ? "" : "s"}, access
          grants, and pending submissions. This action cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <DialogPrimitive.Close asChild>
            <Button variant="outline">Cancel</Button>
          </DialogPrimitive.Close>
          <Button
            variant="danger"
            disabled={!deleteTarget || remove.isPending}
            onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
          >
            <Trash2 />
            {remove.isPending ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
