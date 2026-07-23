import { useQuery } from "@tanstack/react-query";
import type {
  AdminPack as Pack,
  AdminUser as User,
  PendingPublishRequest as RequestItem,
} from "@nest/shared";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "./api";

export function useAdminData() {
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
