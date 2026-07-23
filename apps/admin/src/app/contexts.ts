import { createContext, useContext } from "react";
import type { HubUser } from "@nest/shared";
import type { AdminApi } from "../lib/api";

export type Auth = { user: HubUser };

export const ApiContext = createContext<AdminApi>(null!);
export const AuthContext = createContext<{ auth: Auth; signOut: () => void }>(
  null!,
);

export function useApi() {
  return useContext(ApiContext);
}
