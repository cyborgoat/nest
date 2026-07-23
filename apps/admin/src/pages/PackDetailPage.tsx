import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Archive, Check, Eye, EyeOff, Trash2 } from "lucide-react";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { EditPackDialog, type PackEditPayload } from "../components/EditPackDialog";
import { PackActionsMenu } from "../components/PackActionsMenu";
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorBox,
  InfoRow,
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
  const [editOpen, setEditOpen] = useState(false);
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
    mutationFn: (body: PackEditPayload) =>
      api(`/api/admin/packs/${packId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditOpen(false);
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
    },
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
        <PageHeader
          eyebrow="Catalog"
          title={packs.isLoading ? "Loading pack…" : "Pack not found"}
          description=""
        />
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
          <PackActionsMenu
            pack={pack}
            hideViewDetails
            onEdit={() => setEditOpen(true)}
            onDeleteRequest={setDeleteTarget}
            triggerLabel="Pack actions"
          />
        }
      />
      {(releaseAndAccess.error || update.error || remove.error) && (
        <ErrorBox
          error={releaseAndAccess.error || update.error || remove.error}
        />
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl">Published versions</h2>
                <p className="text-sm text-stone-500">
                  Yank a release to remove it from discovery without deleting
                  its history.
                </p>
              </div>
              <Badge tone={pack.archived ? "stone" : "green"}>
                {pack.archived ? <Archive /> : <Check />}
                {pack.archived ? "Archived" : "Active"}
              </Badge>
            </div>
            <div className="mt-5 divide-y divide-stone-100">
              {pack.releases.map((release) => (
                <div
                  key={release.version}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="font-mono text-sm font-medium">
                      v{release.version}
                    </p>
                    <p className="text-xs text-stone-500">
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
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-600">
              {pack.description || "No description provided."}
            </p>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <h2 className="font-serif text-xl">Access</h2>
            <div className="mt-4 space-y-3 text-sm">
              <InfoRow label="Visibility">
                <Badge
                  tone={pack.visibility === "restricted" ? "amber" : "green"}
                >
                  {pack.visibility}
                </Badge>
              </InfoRow>
              <InfoRow label="Owner">
                <span>
                  {pack.owner_id ? `@${pack.owner_id}` : "Unassigned"}
                </span>
              </InfoRow>
            </div>
          </Card>
          <Card>
            <h2 className="font-serif text-xl">Allowed users</h2>
            <p className="mt-1 text-xs text-stone-500">
              Only selected users and administrators can access a restricted
              pack.
            </p>
            {pack.visibility === "public" ? (
              <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500">
                This pack is{" "}
                <strong className="text-stone-700">public</strong> — every
                signed-in user can already access it, so individual grants
                don't apply. Switch visibility to{" "}
                <button
                  type="button"
                  className="font-medium text-emerald-700 hover:underline"
                  onClick={() => setEditOpen(true)}
                >
                  Restricted in Edit pack
                </button>{" "}
                to manage per-user access.
              </div>
            ) : grantableUsers.length === 0 ? (
              <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500">
                No regular user accounts exist yet — grants only apply to
                accounts with the "User" role (see{" "}
                <Link
                  to="/users"
                  className="font-medium text-emerald-700 hover:underline"
                >
                  User access
                </Link>
                ). Admins and superusers already have access to every pack.
              </div>
            ) : (
              <div className="mt-4 max-h-80 space-y-2 overflow-auto">
                {grantableUsers.map((user) => (
                  <label
                    key={user.uuid}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 p-3 hover:bg-stone-50"
                  >
                    <input
                      type="checkbox"
                      checked={granted.has(user.uuid)}
                      disabled={releaseAndAccess.isPending}
                      onChange={(e) =>
                        releaseAndAccess.mutate({
                          url: `/api/admin/packs/${pack.id}/access/${user.uuid}`,
                          body: { allowed: e.target.checked },
                        })
                      }
                      className="accent-emerald-700"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {user.name}
                      </span>
                      <span className="block truncate text-xs text-stone-500">
                        @{user.id}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
      <EditPackDialog
        pack={pack}
        open={editOpen}
        onOpenChange={setEditOpen}
        busy={update.isPending}
        onSave={(body) => update.mutate(body)}
      />
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete knowledge pack"
        description={`Permanently delete ${deleteTarget?.name ?? "this pack"} and all published releases.`}
      >
        <p className="text-sm leading-6 text-stone-600">
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
