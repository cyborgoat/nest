import { useContext } from "react";
import { Outlet } from "@tanstack/react-router";
import { CircleGauge, LogOut, Package, ShieldCheck, Users } from "lucide-react";
import { Button } from "../components/ui";
import { AuthContext } from "../app/contexts";
import { useAdminPacks, useAdminReviews, useAdminUsers } from "../lib/hooks";
import { NavLink } from "./NavLink";

export function AdminLayout() {
  const { auth, signOut } = useContext(AuthContext);
  const reviews = useAdminReviews();
  const packs = useAdminPacks();
  const users = useAdminUsers();
  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col p-4">
          <div className="flex items-center gap-3 px-2 py-3">
            <img
              src={`${import.meta.env.BASE_URL}nest-logo-transparent.png`}
              alt=""
              className="size-10 object-contain"
              draggable={false}
            />
            <div>
              <p className="text-lg font-semibold leading-none">Nest Hub</p>
              <p className="mt-1 text-xs text-sidebar-muted">
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
            <NavLink
              to="/packs"
              icon={<Package />}
              label="Knowledge packs"
              badge={packs.data?.length}
            />
            <NavLink
              to="/users"
              icon={<Users />}
              label="User access"
              badge={users.data?.length}
            />
          </nav>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-sidebar-border px-2 pt-4 lg:mt-auto lg:block">
            <div>
              <p className="text-sm font-medium">{auth.user.name}</p>
              <p className="text-xs text-sidebar-muted">
                @{auth.user.id} · {auth.user.role}
              </p>
            </div>
            <Button
              variant="sidebar"
              className="justify-start lg:mt-3 lg:w-full"
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
