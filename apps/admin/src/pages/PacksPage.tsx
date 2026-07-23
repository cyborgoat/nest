import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  Check,
  Eye,
  EyeOff,
  Package,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import type { AdminPack as Pack } from "@nest/shared";
import { EditPackDialog, type PackEditPayload } from "../components/EditPackDialog";
import { FilterPills } from "../components/FilterPills";
import { Metric } from "../components/Metric";
import { PackActionsMenu } from "../components/PackActionsMenu";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  DataTable,
  Dialog,
  ErrorBox,
} from "../components/ui";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { useAdminData } from "../lib/hooks";
import { cn } from "../lib/cn";
import { PageHeader } from "../layout/PageHeader";

type StatusFilter = "all" | "active" | "archived" | "restricted";

export function PacksPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { packs } = useAdminData();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editTarget, setEditTarget] = useState<Pack | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Pack | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api("/api/admin/packs/upload", { method: "POST", body });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
      void qc.invalidateQueries({ queryKey: adminQueryKeys.reviews });
    },
  });
  const update = useMutation({
    mutationFn: ({ pack, body }: { pack: Pack; body: PackEditPayload }) =>
      api(`/api/admin/packs/${pack.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditTarget(null);
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
    },
  });
  const remove = useMutation({
    mutationFn: (pack: Pack) =>
      api(`/api/admin/packs/${pack.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteTarget(null);
      void Promise.all([
        qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
        qc.invalidateQueries({ queryKey: adminQueryKeys.reviews }),
      ]);
    },
  });

  const counts = useMemo(() => {
    const all = packs.data ?? [];
    return {
      all: all.length,
      active: all.filter((p) => !p.archived).length,
      archived: all.filter((p) => p.archived).length,
      restricted: all.filter((p) => p.visibility === "restricted").length,
    };
  }, [packs.data]);

  const shown = (packs.data ?? [])
    .filter((pack) =>
      `${pack.id} ${pack.name} ${pack.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .filter((pack) => {
      if (statusFilter === "active") return !pack.archived;
      if (statusFilter === "archived") return pack.archived;
      if (statusFilter === "restricted") return pack.visibility === "restricted";
      return true;
    });

  const columns = useMemo<ColumnDef<Pack>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Pack",
        cell: ({ row }) => (
          <div>
            <Link
              to="/packs/$packId"
              params={{ packId: row.original.id }}
              className="font-medium text-emerald-800 hover:underline"
            >
              {row.original.name}
            </Link>
            <p className="text-xs text-stone-500">{row.original.id}</p>
          </div>
        ),
      },
      {
        accessorKey: "owner_id",
        header: "Owner",
        cell: ({ getValue }) => (
          <span className="text-sm">{String(getValue() || "Unassigned")}</span>
        ),
      },
      {
        accessorKey: "visibility",
        header: "Visibility",
        cell: ({ row }) => (
          <Badge
            tone={row.original.visibility === "restricted" ? "amber" : "green"}
          >
            {row.original.visibility === "restricted" ? <EyeOff /> : <Eye />}
            {row.original.visibility}
          </Badge>
        ),
      },
      {
        id: "releases",
        header: "Releases",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.releases.length}</span>
        ),
      },
      {
        accessorKey: "archived",
        header: "Status",
        cell: ({ row }) => (
          <span
            className={
              row.original.archived ? "text-stone-400" : "text-emerald-700"
            }
          >
            {row.original.archived ? "Archived" : "Active"}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <PackActionsMenu
            pack={row.original}
            onEdit={setEditTarget}
            onDeleteRequest={setDeleteTarget}
          />
        ),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Knowledge packs"
        description="Edit metadata, visibility, user access, and every published version."
        actions={
          <label
            className={cn(
              buttonClass(),
              upload.isPending && "pointer-events-none opacity-50",
            )}
          >
            <Upload className="size-4" />
            {upload.isPending ? "Uploading…" : "Add pack version"}
            <input
              type="file"
              accept=".zip"
              className="sr-only"
              onChange={(e) =>
                e.target.files?.[0] && upload.mutate(e.target.files[0])
              }
            />
          </label>
        }
      />
      {(upload.error || update.error || remove.error) && (
        <ErrorBox error={upload.error || update.error || remove.error} />
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total packs" value={counts.all} icon={<Package />} />
        <Metric label="Active" value={counts.active} icon={<Check />} />
        <Metric
          label="Restricted"
          value={counts.restricted}
          icon={<EyeOff />}
          tone="amber"
        />
        <Metric
          label="Archived"
          value={counts.archived}
          icon={<Archive />}
          tone="stone"
        />
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterPills
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "active", label: "Active", count: counts.active },
            { value: "archived", label: "Archived", count: counts.archived },
            {
              value: "restricted",
              label: "Restricted",
              count: counts.restricted,
            },
          ]}
        />
      </div>
      <Card className="p-0">
        <div className="flex items-center border-b border-stone-200 p-4">
          <Search className="mr-2 size-4 text-stone-400" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search packs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DataTable data={shown} columns={columns} />
      </Card>
      {editTarget && (
        <EditPackDialog
          pack={editTarget}
          open
          onOpenChange={(open) => !open && setEditTarget(null)}
          busy={update.isPending}
          onSave={(body) => update.mutate({ pack: editTarget, body })}
        />
      )}
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
            onClick={() => deleteTarget && remove.mutate(deleteTarget)}
          >
            <Trash2 />
            {remove.isPending ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
