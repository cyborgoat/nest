import React, {
  createContext,
  FormEvent,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  BellRing,
  Check,
  CircleGauge,
  Eye,
  EyeOff,
  LogOut,
  MoreHorizontal,
  Package,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import type {
  AdminPack as Pack,
  AdminUser as User,
  HubSession,
  HubUser,
  PendingPublishRequest as RequestItem,
} from "@nest/shared";
import "./style.css";
import {
  adminQueryKeys,
  createAdminApi,
  type AdminApi as Api,
} from "./lib/api";
import { cn } from "./lib/cn";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  DataTable,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  InfoRow,
  RefreshButton,
  Select,
  formatDate,
} from "./components/ui";

type Auth = { user: HubUser };
const ApiContext = createContext<Api>(null!);
const AuthContext = createContext<{ auth: Auth; signOut: () => void }>(null!);
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

function useApi() {
  return useContext(ApiContext);
}
function useAdminData() {
  const api = useApi();
  const users = useQuery({
    queryKey: adminQueryKeys.users,
    queryFn: () => api<User[]>("/api/admin/users"),
  });
  const reviews = useQuery({
    queryKey: adminQueryKeys.reviews,
    queryFn: () => api<RequestItem[]>("/api/admin/publish-requests"),
  });
  const packs = useQuery({
    queryKey: adminQueryKeys.packs,
    queryFn: () => api<Pack[]>("/api/admin/packs"),
  });
  return { users, reviews, packs };
}

const rootRoute = createRootRoute({ component: AdminLayout });
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});
const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reviews",
  component: ReviewsPage,
});
const packsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/packs",
  component: PacksPage,
});
const packRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/packs/$packId",
  component: PackDetailPage,
});
const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  component: UsersPage,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([
    dashboardRoute,
    reviewsRoute,
    packsRoute,
    packRoute,
    usersRoute,
  ]),
  basepath: "/admin",
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function App() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const api = useMemo<Api>(() => createAdminApi(() => setAuth(null)), []);
  useEffect(() => {
    let active = true;
    void api<HubUser>("/api/auth/me")
      .then((user) => {
        if (active && ["admin", "superuser"].includes(user.role)) {
          setAuth({ user });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setCheckingAuth(false);
      });
    return () => {
      active = false;
    };
  }, [api]);
  if (checkingAuth) {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 text-sm text-stone-500">
        Checking administrator session…
      </div>
    );
  }
  if (!auth)
    return (
      <Login
        onAuth={(next) => {
          setAuth(next);
        }}
      />
    );
  const signOut = () => {
    void fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    queryClient.clear();
    setAuth(null);
  };
  return (
    <ApiContext.Provider value={api}>
      <AuthContext.Provider value={{ auth, signOut }}>
        <RouterProvider router={router} />
      </AuthContext.Provider>
    </ApiContext.Provider>
  );
}

function AdminLayout() {
  const { auth, signOut } = useContext(AuthContext);
  const api = useApi();
  const reviews = useQuery({
    queryKey: adminQueryKeys.reviews,
    queryFn: () => api<RequestItem[]>("/api/admin/publish-requests"),
  });
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-emerald-950/10 bg-emerald-950 text-emerald-50 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col p-4">
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="grid size-10 place-items-center rounded-xl bg-lime-200 font-serif text-2xl text-emerald-950">
              N
            </div>
            <div>
              <p className="font-serif text-lg leading-none">Nest Hub</p>
              <p className="mt-1 text-xs text-emerald-200/60">
                Operations console
              </p>
            </div>
          </div>
          <nav className="mt-5 grid gap-1 sm:grid-cols-4 lg:grid-cols-1">
            <NavLink to="/" icon={<CircleGauge />} label="Overview" />
            <NavLink
              to="/reviews"
              icon={<ShieldCheck />}
              label="Publishing reviews"
              badge={reviews.data?.length}
            />
            <NavLink to="/packs" icon={<Package />} label="Knowledge packs" />
            <NavLink to="/users" icon={<Users />} label="User access" />
          </nav>
          <div className="mt-auto hidden border-t border-white/10 px-2 pt-4 lg:block">
            <p className="text-sm font-medium">{auth.user.name}</p>
            <p className="text-xs text-emerald-200/60">
              @{auth.user.id} · {auth.user.role}
            </p>
            <Button
              variant="sidebar"
              className="mt-3 w-full justify-start"
              onClick={signOut}
            >
              <LogOut />
              Sign out
            </Button>
          </div>
        </div>
      </aside>
      <main className="min-w-0">
        <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavLink({
  to,
  icon,
  label,
  badge,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-emerald-100/70 transition hover:bg-white/5 hover:text-white [&.active]:bg-white/10 [&.active]:text-white"
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
        className: "size-4",
      })}
      <span>{label}</span>
      {badge ? (
        <span className="ml-auto rounded-full bg-lime-200 px-2 py-0.5 text-[10px] font-bold text-emerald-950">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[.18em] text-emerald-700">
          {eyebrow}
        </p>
        <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-500">{description}</p>
      </div>
      {actions}
    </header>
  );
}
function DashboardPage() {
  const { users, reviews, packs } = useAdminData();
  const restricted =
    packs.data?.filter((p) => p.visibility === "restricted").length ?? 0;
  const releases =
    packs.data?.reduce((sum, pack) => sum + pack.releases.length, 0) ?? 0;
  return (
    <>
      <PageHeader
        eyebrow="Superuser administration"
        title="Good governance, at a glance."
        description="Review what needs attention and keep the shared knowledge catalog healthy."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Awaiting review"
          value={reviews.data?.length}
          icon={<BellRing />}
          tone="amber"
        />
        <Metric
          label="Knowledge packs"
          value={packs.data?.length}
          icon={<Package />}
        />
        <Metric label="Published releases" value={releases} icon={<Upload />} />
        <Metric
          label="Restricted packs"
          value={restricted}
          icon={<EyeOff />}
          tone="stone"
        />
      </div>
      <div className="mt-7 grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-xl">Review queue</h2>
              <p className="text-sm text-stone-500">
                Pending community submissions.
              </p>
            </div>
            <Link
              to="/reviews"
              className="text-sm font-medium text-emerald-700 hover:underline"
            >
              View queue
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {reviews.data?.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-stone-200 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-stone-500">
                    {item.pack_id}@{item.version} · @{item.submitter_id}
                  </p>
                </div>
                <Badge>Pending</Badge>
              </div>
            ))}
            {reviews.data?.length === 0 && (
              <Empty
                compact
                title="Queue clear"
                body="No submissions need review."
              />
            )}
          </div>
        </Card>
        <Card>
          <h2 className="font-serif text-xl">Access posture</h2>
          <p className="mt-1 text-sm text-stone-500">
            {users.data?.length ?? 0} registered users
          </p>
          <div className="mt-5 space-y-4">
            <Progress
              label="Public packs"
              value={(packs.data?.length ?? 0) - restricted}
              total={packs.data?.length ?? 0}
            />
            <Progress
              label="Restricted packs"
              value={restricted}
              total={packs.data?.length ?? 0}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
function Metric({
  label,
  value = 0,
  icon,
  tone = "green",
}: {
  label: string;
  value?: number;
  icon: ReactNode;
  tone?: "green" | "amber" | "stone";
}) {
  return (
    <Card className="flex items-center gap-4">
      <div
        className={cn(
          "grid size-11 place-items-center rounded-xl",
          tone === "amber"
            ? "bg-amber-100 text-amber-700"
            : tone === "stone"
              ? "bg-stone-200 text-stone-700"
              : "bg-emerald-100 text-emerald-700",
        )}
      >
        {React.cloneElement(
          icon as React.ReactElement<{ className?: string }>,
          { className: "size-5" },
        )}
      </div>
      <div>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-stone-500">{label}</p>
      </div>
    </Card>
  );
}
function Progress({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const width = total ? `${Math.round((value / total) * 100)}%` : "0%";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-stone-500">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-emerald-600" style={{ width }} />
      </div>
    </div>
  );
}

function ReviewsPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { reviews } = useAdminData();
  const [reject, setReject] = useState<RequestItem | null>(null);
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: ({
      item,
      action,
    }: {
      item: RequestItem;
      action: "approve" | "reject";
    }) =>
      api(`/api/admin/publish-requests/${item.id}/${action}`, {
        method: "POST",
        body: action === "reject" ? JSON.stringify({ note }) : undefined,
      }),
    onSuccess: () => {
      setReject(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: adminQueryKeys.reviews });
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
    },
  });
  return (
    <>
      <PageHeader
        eyebrow="Publishing"
        title="Review queue"
        description="Validate submitted packages before they become available in the Hub."
        actions={
          <RefreshButton
            onClick={() =>
              qc.invalidateQueries({ queryKey: adminQueryKeys.reviews })
            }
            busy={reviews.isFetching}
          />
        }
      />
      {review.error && <ErrorBox error={review.error} />}
      <div className="space-y-4">
        {reviews.data?.map((item) => (
          <Card
            key={item.id}
            className="flex flex-col justify-between gap-6 md:flex-row"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{item.pack_id}</Badge>
                <span className="text-sm font-semibold">v{item.version}</span>
              </div>
              <h2 className="mt-3 font-serif text-2xl">{item.name}</h2>
              <p className="mt-1 max-w-2xl text-sm text-stone-500">
                {item.description || "No description provided."}
              </p>
              <p className="mt-4 text-xs text-stone-500">
                Submitted by{" "}
                <strong className="text-stone-700">
                  {item.submitter_name}
                </strong>{" "}
                · @{item.submitter_id} · {formatDate(item.created_at)}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end justify-between gap-5">
              <code className="rounded bg-stone-100 px-2 py-1 text-[11px] text-stone-500">
                sha256 {item.checksum.slice(0, 14)}…
              </code>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  disabled={review.isPending}
                  onClick={() => setReject(item)}
                >
                  <X />
                  Reject
                </Button>
                <Button
                  disabled={review.isPending}
                  onClick={() => review.mutate({ item, action: "approve" })}
                >
                  <Check />
                  Approve & release
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {reviews.data?.length === 0 && (
          <Empty
            title="The queue is clear"
            body="New pack and version submissions will appear here."
          />
        )}
      </div>
      <Dialog
        open={Boolean(reject)}
        onOpenChange={(open) => !open && setReject(null)}
        title="Reject publish request"
        description={`Explain what ${reject?.submitter_name ?? "the publisher"} should change before resubmitting.`}
      >
        <label className="text-sm font-medium">Review note</label>
        <textarea
          className="input mt-2 min-h-28 resize-y"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          autoFocus
        />
        <div className="mt-5 flex justify-end gap-2">
          <DialogPrimitive.Close asChild>
            <Button variant="outline">Cancel</Button>
          </DialogPrimitive.Close>
          <Button
            variant="danger"
            disabled={!note.trim() || review.isPending}
            onClick={() =>
              reject && review.mutate({ item: reject, action: "reject" })
            }
          >
            Send rejection
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function PacksPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { packs } = useAdminData();
  const [search, setSearch] = useState("");
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
    mutationFn: ({ pack, body }: { pack: Pack; body: unknown }) =>
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
  const shown = (packs.data ?? []).filter((pack) =>
    `${pack.id} ${pack.name} ${pack.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
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
          <DropdownMenuPrimitive.Root>
            <DropdownMenuPrimitive.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Actions for ${row.original.name}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuPrimitive.Trigger>
            <DropdownMenuPrimitive.Portal>
              <DropdownMenuPrimitive.Content
                align="end"
                className="z-50 min-w-40 rounded-lg border border-stone-200 bg-white p-1 shadow-xl"
              >
                <DropdownMenuPrimitive.Item asChild>
                  <Link
                    to="/packs/$packId"
                    params={{ packId: row.original.id }}
                    className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none hover:bg-stone-50 focus:bg-stone-50"
                  >
                    <Eye className="size-4" /> View details
                  </Link>
                </DropdownMenuPrimitive.Item>
                <DropdownMenuPrimitive.Item
                  className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-stone-50"
                  onSelect={() => setEditTarget(row.original)}
                >
                  <Pencil className="size-4" /> Edit
                </DropdownMenuPrimitive.Item>
                <DropdownMenuPrimitive.Item
                  disabled={update.isPending}
                  className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-stone-50"
                  onSelect={() =>
                    update.mutate({
                      pack: row.original,
                      body: { archived: !row.original.archived },
                    })
                  }
                >
                  <Archive className="size-4" />
                  {row.original.archived ? "Restore" : "Archive"}
                </DropdownMenuPrimitive.Item>
                <DropdownMenuPrimitive.Separator className="my-1 h-px bg-stone-100" />
                <DropdownMenuPrimitive.Item
                  className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm text-red-700 outline-none data-[highlighted]:bg-red-50"
                  onSelect={() => setDeleteTarget(row.original)}
                >
                  <Trash2 className="size-4" /> Delete permanently
                </DropdownMenuPrimitive.Item>
              </DropdownMenuPrimitive.Content>
            </DropdownMenuPrimitive.Portal>
          </DropdownMenuPrimitive.Root>
        ),
      },
    ],
    [update],
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

function PackDetailPage() {
  const { packId } = useParams({ from: "/packs/$packId" });
  const api = useApi();
  const qc = useQueryClient();
  const { packs, users } = useAdminData();
  const pack = packs.data?.find((item) => item.id === packId);
  const [editOpen, setEditOpen] = useState(false);
  const mutate = useMutation({
    mutationFn: ({ url, body }: { url: string; body: unknown }) =>
      api(url, {
        method:
          url.includes("/access/") || url.includes("/yank") ? "POST" : "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditOpen(false);
      void qc.invalidateQueries({ queryKey: adminQueryKeys.packs });
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
  return (
    <>
      <PageHeader
        eyebrow="Knowledge pack"
        title={pack.name}
        description={`${pack.id} · ${pack.releases.length} published release${pack.releases.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil />
            Edit pack
          </Button>
        }
      />
      {mutate.error && <ErrorBox error={mutate.error} />}
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
                    disabled={mutate.isPending}
                    onClick={() =>
                      mutate.mutate({
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
          {pack.visibility === "restricted" && (
            <Card>
              <h2 className="font-serif text-xl">Allowed users</h2>
              <p className="mt-1 text-xs text-stone-500">
                Only selected users and administrators can access this pack.
              </p>
              <div className="mt-4 max-h-80 space-y-2 overflow-auto">
                {users.data
                  ?.filter((user) => user.role === "user")
                  .map((user) => (
                    <label
                      key={user.uuid}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-stone-200 p-3 hover:bg-stone-50"
                    >
                      <input
                        type="checkbox"
                        checked={granted.has(user.uuid)}
                        disabled={mutate.isPending}
                        onChange={(e) =>
                          mutate.mutate({
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
            </Card>
          )}
        </div>
      </div>
      <EditPackDialog
        pack={pack}
        open={editOpen}
        onOpenChange={setEditOpen}
        busy={mutate.isPending}
        onSave={(body) =>
          mutate.mutate({ url: `/api/admin/packs/${pack.id}`, body })
        }
      />
    </>
  );
}

function EditPackDialog({
  pack,
  open,
  onOpenChange,
  busy,
  onSave,
}: {
  pack: Pack;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSave: (body: unknown) => void;
}) {
  const [name, setName] = useState(pack.name);
  const [description, setDescription] = useState(pack.description);
  const [owner, setOwner] = useState(pack.owner_id ?? "");
  const [visibility, setVisibility] = useState(pack.visibility);
  const [archived, setArchived] = useState(pack.archived);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit knowledge pack"
      description="Update catalog metadata and access posture."
    >
      <div className="grid gap-4">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <textarea
            className="input min-h-24 resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Owner account ID">
          <input
            className="input"
            value={owner}
            placeholder="Leave blank for no owner"
            onChange={(e) => setOwner(e.target.value)}
          />
        </Field>
        <Field label="Visibility">
          <Select
            value={visibility}
            onValueChange={(value) =>
              setVisibility(value as Pack["visibility"])
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
        <label className="flex items-center gap-3 rounded-lg border border-stone-200 p-3 text-sm">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
            className="accent-emerald-700"
          />
          Archive this pack
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Cancel</Button>
        </DialogPrimitive.Close>
        <Button
          disabled={busy || !name.trim()}
          onClick={() =>
            onSave({
              name,
              description,
              owner_id: owner || null,
              visibility,
              archived,
            })
          }
        >
          Save changes
        </Button>
      </div>
    </Dialog>
  );
}

function UsersPage() {
  const api = useApi();
  const qc = useQueryClient();
  const { auth } = useContext(AuthContext);
  const { users } = useAdminData();
  const [search, setSearch] = useState("");
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
  const data = (users.data ?? []).filter((user) =>
    `${user.name} ${user.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        accessorKey: "name",
        header: "User",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-xs text-stone-500">@{row.original.id}</p>
          </div>
        ),
      },
      {
        accessorKey: "created_at",
        header: "Joined",
        cell: ({ getValue }) => (
          <span className="text-sm text-stone-500">
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
      />
      {(role.error || remove.error) && (
        <ErrorBox error={role.error || remove.error} />
      )}
      <Card className="p-0">
        <div className="flex items-center border-b border-stone-200 p-4">
          <Search className="mr-2 size-4 text-stone-400" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search people…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <DataTable data={data} columns={columns} />
      </Card>
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete user account"
        description={`Permanently delete @${deleteTarget?.id ?? "this user"} and revoke their access.`}
      >
        <p className="text-sm leading-6 text-stone-600">
          Sessions, messages, access grants, and pending submissions will be
          removed. Published packs and reviewed publishing history will remain.
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
            {remove.isPending ? "Deleting…" : "Delete account"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function Login({ onAuth }: { onAuth: (auth: Auth) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: data.get("id"),
          password: data.get("password"),
        }),
      });
      const json = (await response.json()) as
        | HubSession
        | { message?: string | string[] };
      if (!response.ok || !("user" in json)) {
        const rawMessage = "message" in json ? json.message : undefined;
        const message = Array.isArray(rawMessage)
          ? rawMessage.join(". ")
          : rawMessage;
        throw new Error(message || "Sign in failed");
      }
      if (!["admin", "superuser"].includes(json.user.role)) {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        throw new Error("This console is only available to administrators.");
      }
      onAuth({ user: json.user });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid min-h-screen bg-stone-50 lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative hidden overflow-hidden bg-emerald-950 p-16 text-white lg:flex lg:flex-col lg:justify-center">
        <div className="absolute -right-28 -top-28 size-96 rounded-full border border-lime-200/10" />
        <div className="absolute -bottom-48 left-20 size-[34rem] rounded-full border border-lime-200/10" />
        <div className="relative max-w-xl">
          <div className="grid size-14 place-items-center rounded-2xl bg-lime-200 font-serif text-3xl text-emerald-950">
            N
          </div>
          <p className="mt-12 text-xs font-bold uppercase tracking-[.2em] text-lime-200">
            Nest Hub operations
          </p>
          <h1 className="mt-4 font-serif text-6xl leading-[1.03] tracking-tight">
            Guard the quality of shared knowledge.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-emerald-100/65">
            Review releases, manage access, and keep every published version
            trustworthy.
          </p>
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">
            Secure administration
          </p>
          <h2 className="mt-3 font-serif text-4xl">Administrator sign in</h2>
          <p className="mt-2 text-sm text-stone-500">
            Use your Nest Hub administrator credentials.
          </p>
          <div className="mt-8 space-y-4">
            <Field label="Account ID">
              <input
                name="id"
                className="input"
                autoComplete="username"
                required
                autoFocus
              />
            </Field>
            <Field label="Password">
              <input
                name="password"
                className="input"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
          </div>
          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <Button className="mt-6 w-full justify-center py-3" disabled={busy}>
            {busy ? "Signing in…" : "Enter operations console"}
          </Button>
        </form>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
