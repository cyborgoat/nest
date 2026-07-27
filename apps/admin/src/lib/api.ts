export type AdminApi = <T>(url: string, init?: RequestInit) => Promise<T>;

export const adminQueryKeys = {
  users: ["users"] as const,
  reviews: ["reviews"] as const,
  reviewHistory: ["review-history"] as const,
  reviewHistoryFor: (status: string) => ["review-history", status] as const,
  packs: ["packs"] as const,
};

function responseMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    if (Array.isArray(message)) {
      const joined = message
        .filter((item) => typeof item === "string")
        .join(". ");
      if (joined) return joined;
    }
  }
  return `Request failed (${status})`;
}

async function json(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export function createAdminApi(onUnauthorized: () => void): AdminApi {
  let refresh: Promise<boolean> | null = null;

  const refreshSession = () => {
    refresh ??= fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then((response) => response.ok)
      .finally(() => {
        refresh = null;
      });
    return refresh;
  };

  return async <T>(url: string, init: RequestInit = {}): Promise<T> => {
    const request = () =>
      fetch(url, {
        ...init,
        credentials: "same-origin",
        headers: {
          ...(init.body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...init.headers,
        },
      });

    let response = await request();
    if (response.status === 401 && (await refreshSession())) {
      response = await request();
    }
    if (response.status === 401) onUnauthorized();

    const body = await json(response);
    if (!response.ok) throw new Error(responseMessage(body, response.status));
    return body as T;
  };
}
