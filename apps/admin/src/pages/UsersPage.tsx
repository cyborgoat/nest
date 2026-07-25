import { useContext, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Search, ShieldCheck, Trash2, Users as UsersIcon } from "lucide-react";
import type { AdminUser as User } from "@nest/shared";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Metric } from "../components/Metric";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorBox,
  RefreshButton,
  Select,
  formatDate,
} from "../components/ui";
import { AuthContext, useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { useAdminData } from "../lib/hooks";
import { PageHeader } from "../layout/PageHeader";

type RoleFilter = "all" | "admin" | "user";

export function UsersPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { auth } = useContext(AuthContext);
  const { users } = useAdminData();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const role = useMutation({
    mutationFn: ({ user, role }: { user: User; role: User["role"] }) =>
      api(`/api/admin/users/${user.uuid}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: adminQueryKeys.users }),
  });
  const remove = useMutation({
    mutationFn: (user: User) =>
      api(`/api/admin/users/${user.uuid}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteTarget(null);
      void Promise.all([
        qc.invalidateQueries({ queryKey: adminQueryKeys.users }),
        qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
        qc.invalidateQueries({ queryKey: adminQueryKeys.reviews }),
      ]);
    },
  });

  const counts = useMemo(() => {
    const all = users.data ?? [];
    return {
      total: all.length,
      admin: all.filter((u) => u.role === "admin" || u.role === "superuser")
        .length,
      user: all.filter((u) => u.role === "user").length,
    };
  }, [users.data]);

  const data = (users.data ?? [])
    .filter((user) =>
      `${user.name} ${user.id}`.toLowerCase().includes(search.toLowerCase()),
    )
    .filter((user) => {
      if (roleFilter === "admin")
        return user.role === "admin" || user.role === "superuser";
      if (roleFilter === "user") return user.role === "user";
      return true;
    });
  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: "name",
        header: "User",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">@{row.original.id}</p>
          </div>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Joined",
        cell: ({ getValue }) => (
          <span className="text-sm text-muted-foreground">
            {getValue() ? formatDate(String(getValue())) : "—"}
          </span>
        ),
      },
      {
        accessorKey: "role",
        header: "Authorization level",
        cell: ({ row }) => {
          const canChangeRole =
            !row.original.managed &&
            row.original.role !== "superuser" &&
            (auth.user.role === "superuser" || row.original.role === "user");
          return !canChangeRole ? (
            <Badge>
              <ShieldCheck /> {row.original.role}
            </Badge>
          ) : (
            <Select
              value={row.original.role}
              onValueChange={(value) =>
                role.mutate({
                  user: row.original,
                  role: value as User["role"],
                })
              }
              options={[
                { value: "user", label: "User" },
                { value: "admin", label: "Admin" },
              ]}
            />
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const canDelete =
            row.original.role !== "superuser" &&
            (auth.user.role === "superuser" || row.original.role === "user");
          return canDelete ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${row.original.name}`}
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 />
            </Button>
          ) : null;
        },
      },
    ],
    [auth.user.role, role],
  );
  return (
    <>
      <PageHeader
        eyebrow="Authorization"
        title="User access"
        description="Control which accounts can publish, view restricted packs, and administer the Hub."
        actions={
          <RefreshButton
            onClick={() =>
              qc.invalidateQueries({ queryKey: adminQueryKeys.users })
            }
            busy={users.isFetching}
          />
        }
      />
      {(users.error || role.error || remove.error) && (
        <ErrorBox error={users.error || role.error || remove.error} />
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Metric
          label="Total users"
          value={counts.total}
          icon={<UsersIcon />}
          loading={users.isLoading}
          onClick={() => setRoleFilter("all")}
          active={roleFilter === "all"}
        />
        <Metric
          label="Admins"
          value={counts.admin}
          icon={<ShieldCheck />}
          loading={users.isLoading}
          onClick={() => setRoleFilter("admin")}
          active={roleFilter === "admin"}
        />
        <Metric
          label="Regular users"
          value={counts.user}
          icon={<UsersIcon />}
          tone="stone"
          loading={users.isLoading}
          onClick={() => setRoleFilter("user")}
          active={roleFilter === "user"}
        />
      </div>
      <Card className="p-0">
        <div className="flex items-center border-b border-border p-4">
          <Search className="mr-2 size-4 text-muted-foreground" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search people…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DataTable data={data} columns={columns} loading={users.isLoading} />
      </Card>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete user account"
        description={`Permanently delete @${deleteTarget?.id ?? "this user"} and revoke their access.`}
        confirmLabel="Delete account"
        busyLabel="Deleting…"
        icon={<Trash2 />}
        busy={remove.isPending}
        disabled={!deleteTarget}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          Sessions, messages, access grants, and pending submissions will be
          removed. Published packs and reviewed publishing history will remain.
        </p>
      </ConfirmDialog>
    </>
  );
}
