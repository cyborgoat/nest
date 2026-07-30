import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminPack as Pack,
  RegistryResyncResult,
  AdminUser as User,
  PendingPublishRequest as RequestItem,
} from "@nest/shared";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "./api";

const ADMIN_DATA_STALE_MS = 5_000;

export function useAdminUsers() {
  const api = useApi();
  return useQuery({
    queryKey: adminQueryKeys.users,
    queryFn: () => api<User[]>("/api/admin/users"),
    staleTime: ADMIN_DATA_STALE_MS,
  });
}

export function useAdminReviews() {
  const api = useApi();
  return useQuery({
    queryKey: adminQueryKeys.reviews,
    queryFn: () => api<RequestItem[]>("/api/admin/publish-requests"),
    staleTime: ADMIN_DATA_STALE_MS,
    refetchInterval: ADMIN_DATA_STALE_MS,
    refetchOnWindowFocus: true,
  });
}

export function useAdminPacks() {
  const api = useApi();
  return useQuery({
    queryKey: adminQueryKeys.packs,
    queryFn: () => api<Pack[]>("/api/admin/packs"),
    staleTime: ADMIN_DATA_STALE_MS,
  });
}

export function useRegistryResync() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<RegistryResyncResult>("/api/admin/packs/resync", {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.packs }),
  });
}
