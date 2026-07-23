import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminApi } from "./api";

describe("createAdminApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes once and retries an unauthorized request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 42 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const unauthorized = vi.fn();

    await expect(
      createAdminApi(unauthorized)<{ value: number }>("/api/admin/test"),
    ).resolves.toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it("surfaces backend errors and clears unrecoverable sessions", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValueOnce(new Response("{}", { status: 401 })),
    );
    const unauthorized = vi.fn();

    await expect(
      createAdminApi(unauthorized)("/api/admin/test"),
    ).rejects.toThrow("Request failed (401)");
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});
