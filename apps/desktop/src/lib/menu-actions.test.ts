import { afterEach, describe, expect, it, vi } from "vitest";
import { afterMenuClose } from "@/lib/menu-actions";

describe("afterMenuClose", () => {
  afterEach(() => vi.useRealTimers());

  it("defers opening the next interaction layer", () => {
    vi.useFakeTimers();
    const action = vi.fn();

    afterMenuClose(action);
    expect(action).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(action).toHaveBeenCalledOnce();
  });
});
