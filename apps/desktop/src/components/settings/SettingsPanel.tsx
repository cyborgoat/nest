import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppSettings,
  GeneralSettingsUpdate,
  HubConnectionStatus,
  VaultChangeMode,
  VaultChangePreview,
} from "@nest/shared";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Bot,
  CheckCircle2,
  Cloud,
  FolderOpen,
  LoaderCircle,
  Network,
  Palette,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ClaudeAgentSettingsSection } from "@/components/settings/ClaudeAgentSettingsSection";
import { GeneralGroup } from "@/components/settings/GeneralGroup";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { useUiStore } from "@/stores/ui";

const LEGACY_OPENAI_BASE_URL = "https://api.openai.com/v1";
const LEGACY_OPENAI_CHAT_MODEL = "gpt-4o-mini";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_CHAT_MODEL = "openai/gpt-4o-mini";
const MIN_FONT_SIZE_PT = 6;
const MAX_FONT_SIZE_PT = 24;

const EMPTY: AppSettings = {
  llm_base_url: "",
  llm_api_key: "",
  chat_model: "",
  hub_base_url: "",
  proxy_url: "",
  proxy_enabled: false,
  font_size_pt: 10,
  display_language: "en",
  knowledge_dir: "",
  resolved_knowledge_dir: "",
  claude_agent_enabled: false,
  claude_cli_path: "",
  claude_custom_models: "",
};

function withCompatibleLlmDefaults(settings: AppSettings): AppSettings {
  const next = { ...settings };
  const baseUrl = next.llm_base_url.trim().replace(/\/+$/, "");
  const openRouterKey = next.llm_api_key.trim().startsWith("sk-or-v1-");
  if (openRouterKey && (!baseUrl || baseUrl === LEGACY_OPENAI_BASE_URL)) {
    next.llm_base_url = OPENROUTER_BASE_URL;
  }
  if (
    (openRouterKey ||
      next.llm_base_url.trim().replace(/\/+$/, "") === OPENROUTER_BASE_URL) &&
    next.chat_model.trim() === LEGACY_OPENAI_CHAT_MODEL
  ) {
    next.chat_model = OPENROUTER_DEFAULT_CHAT_MODEL;
  }
  return next;
}

/** Persist payload omits transient resolved path differences for dirty checks. */
function persistKey(settings: AppSettings): string {
  const {
    resolved_knowledge_dir: _resolved,
    claude_agent_enabled: _claudeEnabled,
    claude_cli_path: _claudePath,
    claude_custom_models: _claudeModels,
    ...rest
  } = settings;
  return JSON.stringify(rest);
}

function generalPayload(settings: AppSettings): GeneralSettingsUpdate {
  const {
    claude_agent_enabled: _claudeEnabled,
    claude_cli_path: _claudePath,
    claude_custom_models: _claudeModels,
    ...general
  } = settings;
  return general;
}

function describeHubStatus(status: HubConnectionStatus): string {
  return status.online
    ? `Connected to ${status.hub_base_url}`
    : status.message || "Hub is not accessible.";
}

/** Mirrors the Rust-side `validate_http_base_url`/`validate_proxy_url` checks,
 * so a URL field that's merely mid-typing doesn't get auto-saved (and error) on
 * every keystroke pause — only once it's empty or a plausibly complete URL. */
function isCompleteOrEmptyUrl(
  value: string,
  extraSchemes: string[] = [],
): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return (
      ["http:", "https:", ...extraSchemes].includes(url.protocol) &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

const HUB_AUTO_TEST_DELAY_MS = 2000;

export function SettingsPanel() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settingsTarget = useUiStore((state) => state.settingsTarget);
  const clearSettingsTarget = useUiStore(
    (state) => state.clearSettingsTarget,
  );
  const clearPathsUnder = useUiStore((state) => state.clearPathsUnder);
  const [form, setForm] = useState<AppSettings>(EMPTY);
  const [fontSizeDraft, setFontSizeDraft] = useState(
    String(EMPTY.font_size_pt),
  );
  const [hubTestResult, setHubTestResult] = useState<{
    online: boolean;
    message: string;
  } | null>(null);
  const [pendingVaultChange, setPendingVaultChange] = useState<
    (VaultChangePreview & { knowledgeDir: string }) | null
  >(null);
  const hydrated = useRef(false);
  const lastSavedKey = useRef("");
  const hubBaseUrlRef = useRef<HTMLInputElement>(null);
  const claudeSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (settingsTarget !== "hub-url") return;
    const frame = window.requestAnimationFrame(() => {
      hubBaseUrlRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      hubBaseUrlRef.current?.focus({ preventScroll: true });
      clearSettingsTarget();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clearSettingsTarget, settingsTarget]);

  useEffect(() => {
    if (settingsTarget !== "claude-agent") return;
    const frame = window.requestAnimationFrame(() => {
      claudeSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      clearSettingsTarget();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clearSettingsTarget, settingsTarget]);

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.settingsGet,
  });
  const operationQuery = useQuery({
    queryKey: queryKeys.appOperation,
    queryFn: api.appOperationStatus,
    refetchInterval: 500,
  });

  const indexQuery = useQuery({
    queryKey: queryKeys.index,
    queryFn: api.indexStatus,
    refetchInterval: (q) => (q.state.data?.is_indexing ? 1000 : 10_000),
  });

  useEffect(() => {
    if (!settingsQuery.data || hydrated.current) return;
    const data = settingsQuery.data;
    const initial: AppSettings = {
      ...EMPTY,
      ...data,
      // Older backends may omit fields until the desktop binary is rebuilt.
      proxy_enabled:
        typeof data.proxy_enabled === "boolean"
          ? data.proxy_enabled
          : Boolean(data.proxy_url?.trim()),
      claude_agent_enabled: data.claude_agent_enabled ?? false,
      claude_cli_path: data.claude_cli_path ?? "",
      claude_custom_models: data.claude_custom_models ?? "",
    };
    setForm(initial);
    setFontSizeDraft(String(initial.font_size_pt));
    lastSavedKey.current = persistKey(initial);
    hydrated.current = true;
  }, [settingsQuery.data]);

  useEffect(() => {
    setFontSizeDraft(String(form.font_size_pt));
  }, [form.font_size_pt]);

  useEffect(() => {
    if (!hydrated.current) return;
    const key = persistKey(form);
    if (key === lastSavedKey.current) return;
    // Don't attempt (and error-toast) a save while a URL field is still
    // mid-typing and not yet a complete address — wait for it to either
    // finish or empty out. Other fields keep saving normally in the meantime.
    if (
      !isCompleteOrEmptyUrl(form.hub_base_url) ||
      !isCompleteOrEmptyUrl(form.llm_base_url) ||
      (form.proxy_enabled &&
        !isCompleteOrEmptyUrl(form.proxy_url, ["socks5:", "socks5h:"]))
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await api.settingsSet(generalPayload(form));
          const refreshed = await api.settingsGet();
          lastSavedKey.current = persistKey(refreshed);
          setForm((prev) => ({
            ...prev,
            font_size_pt: refreshed.font_size_pt,
            display_language: refreshed.display_language,
            resolved_knowledge_dir: refreshed.resolved_knowledge_dir,
          }));
          queryClient.setQueryData(queryKeys.settings, refreshed);
          void queryClient.invalidateQueries({ queryKey: queryKeys.hubStatus });
          void queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
          void queryClient.invalidateQueries({ queryKey: queryKeys.tree });
          void queryClient.invalidateQueries({
            queryKey: queryKeys.installedPacks,
          });
        } catch (e) {
          toast.error(t("settings.couldNotSave"), {
            description: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [form, queryClient, t]);

  const update = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    if (
      key === "hub_base_url" ||
      key === "proxy_url" ||
      key === "proxy_enabled"
    ) {
      setHubTestResult(null);
    }
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      return key === "llm_api_key" ||
        key === "llm_base_url" ||
        key === "chat_model"
        ? withCompatibleLlmDefaults(next)
        : next;
    });
  };

  const commitFontSizeInput = () => {
    const parsed = Number.parseInt(fontSizeDraft.trim(), 10);
    const valid =
      Number.isFinite(parsed) &&
      parsed >= MIN_FONT_SIZE_PT &&
      parsed <= MAX_FONT_SIZE_PT;

    if (!valid) {
      toast.warning(t("settings.fontSizeWarningTitle"), {
        description: t("settings.fontSizeWarningDescription", {
          min: MIN_FONT_SIZE_PT,
          max: MAX_FONT_SIZE_PT,
        }),
      });
      return;
    }

    if (parsed !== form.font_size_pt) {
      update("font_size_pt", parsed);
    }
    setFontSizeDraft(String(parsed));
  };

  const syncIndex = useMutation({
    mutationFn: () => api.indexRebuild(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.index });
    },
    onError: (e) =>
      toast.error(t("settings.syncFailed"), {
        description: e instanceof Error ? e.message : String(e),
      }),
  });

  const testHubConnection = useMutation({
    mutationFn: () =>
      api.hubTestConnection(
        form.hub_base_url,
        form.proxy_enabled ? form.proxy_url : "",
      ),
    onSuccess: (status) => {
      const message = describeHubStatus(status);
      setHubTestResult({ online: status.online, message });
      if (status.online) {
        toast.success(t("settings.connected"), { description: message });
      } else {
        toast.error(t("settings.connectionFailed"), { description: message });
      }
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      setHubTestResult({ online: false, message });
      toast.error(t("settings.couldNotTestHub"), { description: message });
    },
  });

  // Auto-validates the Hub URL a couple seconds after the user stops typing,
  // instead of on every keystroke. Silent (no toast) since it's not a direct
  // user action; the manual "Test connection" button still confirms with one.
  useEffect(() => {
    if (!hydrated.current) return;
    const url = form.hub_base_url.trim();
    if (!url || !isCompleteOrEmptyUrl(url)) return;
    const proxy = form.proxy_enabled ? form.proxy_url : "";
    const timer = window.setTimeout(() => {
      void api
        .hubTestConnection(url, proxy)
        .then((status) => {
          setHubTestResult({
            online: status.online,
            message: describeHubStatus(status),
          });
        })
        .catch((e: unknown) => {
          setHubTestResult({
            online: false,
            message: e instanceof Error ? e.message : String(e),
          });
        });
    }, HUB_AUTO_TEST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [form.hub_base_url, form.proxy_enabled, form.proxy_url]);

  const changeVault = useMutation({
    mutationFn: ({
      knowledgeDir,
      mode,
    }: {
      knowledgeDir: string;
      mode: VaultChangeMode;
    }) => api.settingsChangeKnowledgeDir(knowledgeDir, mode),
    onSuccess: (result) => {
      const installed =
        queryClient.getQueryData<import("@nest/shared").InstalledPack[]>(
          queryKeys.installedPacks,
        ) ?? [];
      for (const pack of installed) clearPathsUnder(pack.local_path);
      const refreshed = result.settings;
      lastSavedKey.current = persistKey(refreshed);
      setForm(refreshed);
      setPendingVaultChange(null);
      queryClient.setQueryData(queryKeys.settings, refreshed);
      for (const key of [
        queryKeys.tree,
        queryKeys.index,
        queryKeys.installedPacks,
        queryKeys.allFiles,
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (result.cleanup_warning) {
        toast.warning("Knowledge directory changed", {
          description: result.cleanup_warning,
        });
      } else {
        toast.success("Knowledge directory changed");
      }
    },
    onError: (error) => {
      toast.error("Could not change knowledge directory", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const prepareKnowledgeDirChange = async (knowledgeDir: string) => {
    try {
      const preview = await api.settingsPreviewKnowledgeDir(knowledgeDir);
      setPendingVaultChange({ ...preview, knowledgeDir });
    } catch (error) {
      toast.error("Could not use this knowledge directory", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const pickKnowledgeDir = async () => {
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose knowledge directory",
      });
      if (typeof result === "string" && result) {
        await prepareKnowledgeDirChange(result);
      }
    } catch (e) {
      toast.error(t("settings.couldNotOpenFolder"), {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const displayKnowledgePath =
    form.knowledge_dir.trim() ||
    form.resolved_knowledge_dir ||
    "Loading default…";
  const usingDefaultKnowledge = !form.knowledge_dir.trim();

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={t("settings.title")}
        description={t("settings.description")}
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl px-6 py-5">
          {operationQuery.data && (
            <p className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {operationQuery.data.kind.replace(/_/g, " ")} is running for {operationQuery.data.owner}
            </p>
          )}
          <fieldset disabled={operationQuery.data != null} className="contents">
          <SettingsSection>
                <GeneralGroup icon={Cloud} title={t("settings.knowledgeHub")}>
                  <Field
                    label={t("settings.hubBaseUrl")}
                    description={t("settings.hubBaseUrlDescription")}
                  >
                    <Input
                      ref={hubBaseUrlRef}
                      value={form.hub_base_url}
                      onChange={(e) => update("hub_base_url", e.target.value)}
                      placeholder="http://127.0.0.1:8787"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {hubTestResult ? (
                        <p
                          className={
                            hubTestResult.online
                              ? "flex items-center gap-1.5 text-xs text-primary"
                              : "flex items-center gap-1.5 text-xs text-destructive"
                          }
                        >
                          {hubTestResult.online ? (
                            <CheckCircle2 className="size-3.5 shrink-0" />
                          ) : (
                            <XCircle className="size-3.5 shrink-0" />
                          )}
                          {hubTestResult.message}
                        </p>
                      ) : (
                        <span />
                      )}
                      <Button
                        type="button"
                        size="sm"
                        disabled={testHubConnection.isPending}
                        onClick={() => testHubConnection.mutate()}
                      >
                        {testHubConnection.isPending && (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        )}
                        {testHubConnection.isPending
                          ? t("settings.testing")
                          : t("settings.testConnection")}
                      </Button>
                    </div>
                  </Field>
                </GeneralGroup>
                <GeneralGroup icon={FolderOpen} title="Knowledge vault">
                  <Field
                    label={t("settings.knowledgeDirectory")}
                    description={t("settings.knowledgeDirectoryDescription")}
                  >
                    <div className="flex min-w-0 gap-2">
                      <Input
                        value={displayKnowledgePath}
                        readOnly
                        title={displayKnowledgePath}
                        className="min-w-0 flex-1 font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => void pickKnowledgeDir()}
                      >
                        <FolderOpen className="size-4" />
                        {t("hub.browse")}
                      </Button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <p className="text-xs text-muted-foreground">
                        {usingDefaultKnowledge
                          ? t("settings.usingDefaultVault")
                          : t("settings.usingCustomVault")}
                      </p>
                      {!usingDefaultKnowledge && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void prepareKnowledgeDirChange("")}
                        >
                          {t("settings.resetToDefault")}
                        </Button>
                      )}
                    </div>
                  </Field>
                </GeneralGroup>
                <GeneralGroup icon={Palette} title={t("settings.appearance")}>
                  <Field
                    label={t("settings.fontSize")}
                    description={t("settings.fontSizeDescription")}
                  >
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={fontSizeDraft}
                      onChange={(e) => setFontSizeDraft(e.target.value)}
                      onBlur={commitFontSizeInput}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitFontSizeInput();
                        }
                      }}
                      placeholder={`${MIN_FONT_SIZE_PT}-${MAX_FONT_SIZE_PT}`}
                    />
                  </Field>
                </GeneralGroup>
                <GeneralGroup
                  icon={Bot}
                  title={t("settings.llm")}
                  help={
                    <div className="space-y-2">
                      <p>
                        Use the Base URL, API key, and exact model ID from the
                        same OpenAI-compatible provider.
                      </p>
                      <p>
                        OpenAI example:{" "}
                        <span className="font-mono">
                          https://api.openai.com/v1
                        </span>{" "}
                        with <span className="font-mono">gpt-4o-mini</span>.
                      </p>
                      <p>
                        OpenRouter example:{" "}
                        <span className="font-mono">
                          https://openrouter.ai/api/v1
                        </span>{" "}
                        with{" "}
                        <span className="font-mono">openai/gpt-4o-mini</span>.
                      </p>
                    </div>
                  }
                >
                  <Field
                    label={t("settings.baseUrl")}
                    description={t("settings.baseUrlDescription")}
                  >
                    <Input
                      value={form.llm_base_url}
                      onChange={(e) => update("llm_base_url", e.target.value)}
                      placeholder="https://openrouter.ai/api/v1"
                    />
                  </Field>
                  <Field
                    label={t("settings.apiKey")}
                    description={t("settings.apiKeyDescription")}
                  >
                    <Input
                      type="password"
                      value={form.llm_api_key}
                      onChange={(e) => update("llm_api_key", e.target.value)}
                      placeholder="sk-…"
                    />
                    {form.llm_api_key.trim().startsWith("sk-or-v1-") && (
                      <p className="text-xs text-muted-foreground">
                        OpenRouter key detected. Requests use{" "}
                        <span className="font-mono">{OPENROUTER_BASE_URL}</span>{" "}
                        and an OpenRouter model slug.
                      </p>
                    )}
                  </Field>
                  <Field
                    label={t("settings.chatModel")}
                    description={t("settings.chatModelDescription")}
                  >
                    <Input
                      value={form.chat_model}
                      onChange={(e) => update("chat_model", e.target.value)}
                      placeholder="openai/gpt-4o-mini"
                    />
                  </Field>
                </GeneralGroup>
                <div ref={claudeSectionRef}>
                  <ClaudeAgentSettingsSection settingsQuery={settingsQuery} />
                </div>

                <GeneralGroup icon={Network} title={t("settings.network")}>
                  <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/40 px-3 py-3">
                    <div className="min-w-0 space-y-1">
                      <Label
                        htmlFor="proxy-enabled"
                        className="text-sm font-medium"
                      >
                        {t("settings.proxyEnabled")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.proxyEnabledDescription")}
                      </p>
                    </div>
                    <Switch
                      id="proxy-enabled"
                      checked={Boolean(form.proxy_enabled)}
                      onCheckedChange={(checked) =>
                        update("proxy_enabled", checked)
                      }
                      aria-label={t("settings.proxyEnabled")}
                    />
                  </div>
                  <Field
                    label={t("settings.proxyUrl")}
                    description={t("settings.proxyUrlDescription")}
                  >
                    <Input
                      value={form.proxy_url}
                      onChange={(e) => update("proxy_url", e.target.value)}
                      placeholder="http://127.0.0.1:7890"
                      disabled={!form.proxy_enabled}
                    />
                  </Field>
                </GeneralGroup>
                <Field
                  label={t("settings.localIndex")}
                  description={t("settings.localIndexDescription")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {indexQuery.data?.indexed_files ?? 0}{" "}
                      {t("settings.indexFiles")} ·{" "}
                      {indexQuery.data?.indexed_chunks ?? 0}{" "}
                      {t("settings.indexChunks")}
                      {indexQuery.data?.message
                        ? ` — ${indexQuery.data.message}`
                        : ""}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={
                        syncIndex.isPending || indexQuery.data?.is_indexing
                      }
                      onClick={() => syncIndex.mutate()}
                    >
                      {(syncIndex.isPending || indexQuery.data?.is_indexing) && (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      )}
                      {syncIndex.isPending || indexQuery.data?.is_indexing
                        ? t("settings.syncing")
                        : t("settings.syncIndexNow")}
                    </Button>
                  </div>
                </Field>
          </SettingsSection>
          </fieldset>
        </div>
      </ScrollArea>
      <AlertDialog
        open={Boolean(pendingVaultChange)}
        onOpenChange={(open) => {
          if (!open && !changeVault.isPending) setPendingVaultChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change knowledge directory?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Nest found {pendingVaultChange?.managed_pack_count ?? 0}{" "}
                  managed knowledge packs. The new directory must stay empty
                  until this change finishes.
                </p>
                <div className="rounded-md border bg-muted/40 p-3 text-xs">
                  <p
                    className="truncate"
                    title={pendingVaultChange?.current_path}
                  >
                    From: {pendingVaultChange?.current_path}
                  </p>
                  <p
                    className="mt-1 truncate"
                    title={pendingVaultChange?.target_path}
                  >
                    To: {pendingVaultChange?.target_path}
                  </p>
                </div>
                <p>
                  Migrate copies and verifies every managed pack before removing
                  its old folder. Start fresh removes the old managed packs and
                  installs new English and Simplified Chinese Getting Started
                  packs. Unrelated files in the old directory are preserved.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:items-center">
            <AlertDialogCancel disabled={changeVault.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={!pendingVaultChange || changeVault.isPending}
              onClick={() => {
                if (!pendingVaultChange) return;
                changeVault.mutate({
                  knowledgeDir: pendingVaultChange.knowledgeDir,
                  mode: "delete_and_seed_defaults",
                });
              }}
            >
              Start fresh
            </Button>
            <Button
              type="button"
              disabled={!pendingVaultChange || changeVault.isPending}
              onClick={() => {
                if (!pendingVaultChange) return;
                changeVault.mutate({
                  knowledgeDir: pendingVaultChange.knowledgeDir,
                  mode: "move",
                });
              }}
            >
              {changeVault.isPending ? "Changing…" : "Migrate packs"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SettingsSection({ children }: { children: ReactNode }) {
  return <section className="space-y-8">{children}</section>;
}
