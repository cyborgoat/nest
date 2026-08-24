import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@nest/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { ClaudeAgentSettingsSection } from "./ClaudeAgentSettingsSection";

vi.mock("@/lib/api", () => ({
  api: {
    claudeDetectCli: vi.fn(),
    claudeTestConnection: vi.fn(),
    claudeSaveSettings: vi.fn(),
    claudeConnectionStatus: vi.fn().mockResolvedValue({
      status: "disabled",
      configured_cli_path: "",
      resolved_cli_path: "",
      cli_version: "",
      effective_model: "",
      tested_at: "",
      message: null,
    }),
  },
}));

function renderSection(data: AppSettings | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <I18nProvider locale="en">
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ClaudeAgentSettingsSection settingsQuery={{ data }} />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("ClaudeAgentSettingsSection", () => {
  it("renders the Claude configuration controls", () => {
    const html = renderSection(undefined);
    expect(html).toContain("Claude Agent");
    expect(html).toContain("Enable Claude Agent");
    expect(html).toContain("Auto-detect");
    expect(html).toContain("Test connection");
    expect(html).toContain("Custom models");
    expect(html).toContain("empty = auto-detect");
    expect(html).toContain("Add model");
  });

  it("shows the plain Save action while the toggle is off", () => {
    const html = renderSection(undefined);
    expect(html).toContain("Save");
    expect(html).not.toContain("Save and connect");
  });

  it("does not claim a connection before any test result exists", () => {
    const html = renderSection(undefined);
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("Not connected");
  });

  it("uses the default placeholder before any detection attempt", () => {
    const html = renderSection(undefined);
    expect(html).not.toContain("Auto-detect Not Found");
    expect(html).toContain("empty = auto-detect");
  });
});
