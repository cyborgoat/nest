import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrowseTab } from "./BrowseTab";

const baseProps = {
  packs: undefined,
  filteredPacks: [],
  packsLoading: false,
  packsError: null,
  search: "",
  onSearchChange: vi.fn(),
  installedById: new Map(),
  busy: false,
  onInstall: vi.fn(),
  onRemove: vi.fn(),
  onExport: vi.fn(),
  onConfigureHub: vi.fn(),
  onRetryConnection: vi.fn(),
  retryingConnection: false,
};

describe("BrowseTab connection states", () => {
  it("offers one configuration action when the Hub URL is missing", () => {
    const html = renderToStaticMarkup(
      <BrowseTab
        {...baseProps}
        connectionState={{ kind: "setup-required" }}
      />,
    );

    expect(html).toContain("Connect a Hub to browse packs");
    expect(html).toContain("Configure Hub");
    expect(html).not.toContain(">Import<");
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("offers retry and Settings actions for connection failures", () => {
    const html = renderToStaticMarkup(
      <BrowseTab
        {...baseProps}
        connectionState={{
          kind: "connection-error",
          message: "Connection timed out",
        }}
      />,
    );

    expect(html).toContain("Hub is unavailable");
    expect(html).toContain("Connection timed out");
    expect(html).toContain("Retry connection");
    expect(html).toContain("Open Hub settings");
    expect(html).not.toContain(">Import<");
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});
