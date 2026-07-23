import { useEffect, useMemo, useState } from "react";
import { RouterProvider } from "@tanstack/react-router";
import type { HubUser } from "@nest/shared";
import { createAdminApi, type AdminApi as Api } from "../lib/api";
import { Login } from "../pages/Login";
import { ApiContext, AuthContext, type Auth } from "./contexts";
import { queryClient } from "./query-client";
import { router } from "./router";

export function App() {
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
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
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
