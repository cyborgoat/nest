import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("@/lib/api", () => ({
  api: {
    settingsGet: vi.fn().mockResolvedValue({
      llm_base_url: "https://api.openai.com/v1",
      llm_api_key: "sk-x",
      chat_model: "gpt-4o-mini",
      hub_base_url: "",
      proxy_url: "",
      proxy_enabled: false,
      font_size_pt: 12,
      display_language: "en",
      knowledge_dir: "",
      resolved_knowledge_dir: "",
      claude_agent_enabled: true,
      claude_cli_path: "G:\\Apps\\nodejs\\node_global\\claude.cmd",
      claude_custom_args: "",
      claude_custom_models: "glm-5.3",
    }),
    settingsPreviewKnowledgeDir: vi.fn(),
    settingsChangeKnowledgeDir: vi.fn(),
    hubTestConnection: vi.fn(),
    claudeDetectCli: vi.fn(),
    claudeTestConnection: vi
      .fn()
      .mockResolvedValue({
        status: "connected",
        configured_cli_path: "",
        configured_cli_args: "",
        resolved_cli_path: "",
        cli_version: "2.1.238",
        effective_model: "glm-5.3[1m]",
        tested_at: "2026-01-01T00:00:00Z",
        message: null,
      }),
    claudeSaveSettings: vi.fn(),
    claudeModelStatuses: vi.fn().mockResolvedValue({}),
    appOperationStatus: vi.fn().mockResolvedValue(null),
    claudeConnectionStatus: vi.fn().mockResolvedValue({
      status: "connected",
      configured_cli_path: "",
      configured_cli_args: "",
      resolved_cli_path: "",
      cli_version: "2.1.238",
      effective_model: "glm-5.3[1m]",
      tested_at: "2026-01-01T00:00:00Z",
      message: null,
    }),
    claudeModelOptions: vi.fn().mockResolvedValue([
      { model_id: "", source: "default" },
      { model_id: "glm-5.3[1m]", source: "custom" },
    ]),
    vaultListTree: vi.fn().mockResolvedValue([]),
    hubListInstalled: vi.fn().mockResolvedValue([]),
    indexStatus: vi.fn().mockResolvedValue({
      indexed_files: 0,
      indexed_chunks: 0,
      phase: "idle",
      processed_chunks: 0,
      total_chunks: 0,
      is_indexing: false,
      last_indexed_at: null,
      message: null,
    }),
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <I18nProvider locale="en">
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SettingsPanel />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("SettingsPanel with live settings data", () => {
  afterEach(cleanup);

  it("renders Claude Agent as an enabled item within LLM settings", async () => {
    const { container } = renderPanel();
    expect(container.innerHTML).toContain("Claude Agent");
    await waitFor(() => {
      expect(container.innerHTML).toContain(
        "the default model appears here automatically",
      );
    });
    const claudeHeading = Array.from(container.querySelectorAll("h5")).find(
      (heading) => heading.textContent === "Claude Agent",
    );
    const llmHeading = Array.from(container.querySelectorAll("h4")).find(
      (heading) => heading.textContent?.startsWith("LLM"),
    );
    expect(llmHeading?.parentElement?.parentElement).toContainElement(
      claudeHeading ?? null,
    );
    expect(llmHeading?.className).not.toContain("uppercase");

    const connectionButtons = screen.getAllByRole("button", {
      name: "Test connection",
    });
    expect(connectionButtons).toHaveLength(2);
    for (const button of connectionButtons) {
      expect(button).not.toHaveTextContent("Test connection");
      expect(button.querySelector(".lucide-plug-zap")).toBeInTheDocument();
    }
    const hubUrlInput = screen.getByPlaceholderText("http://127.0.0.1:8787");
    expect(hubUrlInput.parentElement).toHaveClass("items-center");
    expect(
      hubUrlInput.parentElement?.querySelector(
        'button[aria-label="Test connection"]',
      ),
    ).toBeInTheDocument();
    const vaultInput = container.querySelector<HTMLInputElement>(
      "input[readonly]:not([disabled])",
    );
    expect(vaultInput).not.toBeNull();
    expect(vaultInput?.parentElement).toHaveClass("items-center");
    expect(vaultInput?.parentElement).toContainElement(
      screen.getByRole("button", { name: "Browse" }),
    );
  });
});
