import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@nest/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { ClaudeAgentSettingsSection } from "./ClaudeAgentSettingsSection";

const apiMocks = vi.hoisted(() => ({
  claudeDetectCli: vi.fn(),
  claudeTestConnection: vi.fn(),
  claudeTestModel: vi.fn(),
  claudeModelStatuses: vi.fn(),
  claudeSaveSettings: vi.fn(),
  claudeConnectionStatus: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    claudeDetectCli: apiMocks.claudeDetectCli,
    claudeTestConnection: apiMocks.claudeTestConnection,
    claudeTestModel: apiMocks.claudeTestModel,
    claudeModelStatuses: apiMocks.claudeModelStatuses,
    claudeSaveSettings: apiMocks.claudeSaveSettings,
    claudeConnectionStatus: apiMocks.claudeConnectionStatus,
  },
}));

function renderSection(data: AppSettings | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <I18nProvider locale="en">
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ClaudeAgentSettingsSection settingsQuery={{ data }} />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const enabledSettings: AppSettings = {
  llm_base_url: "https://api.openai.com/v1",
  llm_api_key: "",
  chat_model: "gpt-4o-mini",
  hub_base_url: "",
  proxy_url: "",
  proxy_enabled: false,
  font_size_pt: 12,
  display_language: "en",
  knowledge_dir: "",
  resolved_knowledge_dir: "",
  claude_agent_enabled: true,
  claude_cli_path: "/saved/claude",
  claude_custom_models: "kimi",
};

function report(overrides: Record<string, string | null> = {}) {
  return {
    status: "connected" as const,
    configured_cli_path: "/saved/claude",
    resolved_cli_path: "/saved/claude",
    cli_version: "2.1.238",
    effective_model: "claude-default",
    tested_at: "2026-08-29T00:00:00Z",
    message: null,
    ...overrides,
  };
}

describe("ClaudeAgentSettingsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.claudeConnectionStatus.mockResolvedValue({
      status: "disabled",
      configured_cli_path: "",
      resolved_cli_path: "",
      cli_version: "",
      effective_model: "",
      tested_at: "",
      message: null,
    });
    apiMocks.claudeModelStatuses.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("renders the Claude configuration controls", () => {
    const { container } = renderSection(undefined);
    const html = container.innerHTML;
    expect(html).toContain("Claude Agent");
    expect(html).toContain("Enable Claude Agent");
    expect(html).toContain("Auto-detect");
    expect(html).toContain("Test connection");
    expect(html).toContain("Custom models");
    expect(html).toContain("empty = auto-detect");
    expect(html).toContain("Add model");
  });

  it("shows the plain Save action while the toggle is off", () => {
    const html = renderSection(undefined).container.innerHTML;
    expect(html).toContain("Save");
    expect(html).not.toContain("Save and connect");
  });

  it("does not claim a connection before any test result exists", () => {
    const html = renderSection(undefined).container.innerHTML;
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("Not connected");
  });

  it("uses the default placeholder before any detection attempt", () => {
    const { container } = renderSection(undefined);
    expect(container.innerHTML).not.toContain("Auto-detect Not Found");
    expect(container.innerHTML).toContain("empty = auto-detect");
  });

  it("clears a connection result when the CLI path changes", async () => {
    apiMocks.claudeConnectionStatus.mockResolvedValue(report());
    apiMocks.claudeTestConnection.mockResolvedValue(
      report({ effective_model: "claude-tested" }),
    );
    renderSection(enabledSettings);

    fireEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(await screen.findByDisplayValue("claude-tested")).toBeDisabled();

    const cliPath = screen.getByPlaceholderText(/claude\.exe/);
    fireEvent.change(cliPath, { target: { value: "/draft/claude" } });

    await waitFor(() => {
      expect(screen.queryByDisplayValue("claude-tested")).not.toBeInTheDocument();
      expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    });
  });

  it("disables Claude settings while a model test is running", async () => {
    apiMocks.claudeConnectionStatus.mockResolvedValue(report());
    apiMocks.claudeModelStatuses.mockResolvedValue({
      kimi: {
        configured_cli_path: "/saved/claude",
        ok: true,
        message: null,
        tested_at: "2026-08-29T00:00:00Z",
      },
    });
    apiMocks.claudeTestModel.mockImplementation(() => new Promise(() => {}));
    renderSection(enabledSettings);

    fireEvent.click(await screen.findByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/claude\.exe/)).toBeDisabled();
      expect(screen.getByLabelText("Model 1")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save and connect" })).toBeDisabled();
    });
  });
});
