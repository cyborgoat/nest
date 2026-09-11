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
  claude_custom_args: "--skip-safe-check",
};

function report(overrides: Record<string, string | null> = {}) {
  return {
    status: "connected" as const,
    configured_cli_path: "/saved/claude",
    configured_cli_args: "--skip-safe-check",
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
      configured_cli_args: "",
      resolved_cli_path: "",
      cli_version: "",
      effective_model: "",
      tested_at: "",
      message: null,
    });
    apiMocks.claudeModelStatuses.mockResolvedValue({});
    apiMocks.claudeSaveSettings.mockResolvedValue(
      report({
        status: "disabled",
        configured_cli_path: "",
        configured_cli_args: "",
        resolved_cli_path: "",
        cli_version: "",
        effective_model: "",
        tested_at: "",
      }),
    );
  });

  afterEach(cleanup);

  it("hides Claude configuration controls while the feature is disabled", () => {
    const { container } = renderSection(undefined);
    const html = container.innerHTML;
    expect(html).toContain("Claude Agent");
    expect(html).toContain("Enable Claude Agent");
    expect(html).not.toContain("Auto-detect");
    expect(html).not.toContain("Test connection");
    expect(html).not.toContain("Custom models");
    expect(html).not.toContain("Custom startup arguments");
    expect(apiMocks.claudeConnectionStatus).not.toHaveBeenCalled();
    expect(apiMocks.claudeModelStatuses).not.toHaveBeenCalled();
  });

  it("reveals Claude configuration controls when enabled", async () => {
    renderSection(undefined);
    fireEvent.click(screen.getByRole("switch", { name: "Enable Claude Agent" }));

    expect(await screen.findByText("CLI path")).toBeInTheDocument();
    const autoDetect = screen.getByRole("button", { name: "Auto-detect" });
    expect(autoDetect).toHaveClass(
      "h-7",
      "bg-neutral-800",
      "disabled:opacity-100",
    );
    expect(autoDetect.parentElement).toHaveClass("items-center");
    expect(
      screen.getByRole("switch", { name: "Enable Claude Agent" }),
    ).toHaveClass(
      "data-[state=checked]:border-neutral-800",
      "data-[state=checked]:bg-neutral-800",
    );
    const testConnection = screen.getByRole("button", {
      name: "Test connection",
    });
    expect(testConnection).not.toHaveTextContent("Test connection");
    expect(testConnection.querySelector(".lucide-plug-zap")).toBeInTheDocument();
    expect(testConnection.parentElement?.parentElement).toHaveClass(
      "items-center",
      "justify-between",
    );
    expect(screen.getByText("Custom models")).toBeInTheDocument();
    expect(screen.getByText("Custom startup arguments")).toBeInTheDocument();
  });

  it("automatically saves changes without showing a save button", async () => {
    renderSection({
      ...enabledSettings,
      claude_agent_enabled: false,
      claude_cli_path: "",
      claude_custom_models: "",
      claude_custom_args: "",
    });
    fireEvent.click(screen.getByRole("switch", { name: "Enable Claude Agent" }));

    expect(screen.queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();
    await waitFor(
      () => {
        expect(apiMocks.claudeSaveSettings).toHaveBeenCalledWith({
          enabled: true,
          cliPath: "",
          customArgs: "",
          customModels: "",
        });
      },
      { timeout: 1_500 },
    );
  });

  it("does not claim a connection before any test result exists", () => {
    const html = renderSection(undefined).container.innerHTML;
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("Not connected");
  });

  it("uses the default placeholder before any detection attempt", async () => {
    renderSection(enabledSettings);
    const input = await screen.findByPlaceholderText(/empty = auto-detect/);
    expect(input).toBeInTheDocument();
    expect(screen.queryByText("Auto-detect Not Found")).not.toBeInTheDocument();
  });

  it("shows a spinner while auto-detection is running", async () => {
    apiMocks.claudeDetectCli.mockImplementation(() => new Promise(() => {}));
    renderSection(enabledSettings);

    fireEvent.click(
      await screen.findByRole("button", { name: "Auto-detect" }),
    );

    expect(await screen.findByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(screen.getByText("Detecting…").closest("button")).toBeDisabled();
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

});
