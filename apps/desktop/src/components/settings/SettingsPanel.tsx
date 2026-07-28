import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppSettings,
  VaultChangeMode,
  VaultChangePreview,
} from "@nest/shared";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Bot,
  Cloud,
  FolderOpen,
  Info,
  LoaderCircle,
  Network,
  Palette,
  Settings2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { useUiStore, type SettingsSection } from "@/stores/ui";
import { HubAccountSettings } from "./HubAccountSettings";

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
  const { resolved_knowledge_dir: _, ...rest } = settings;
  return JSON.stringify(rest);
}

export function SettingsPanel() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settingsSection = useUiStore((state) => state.settingsSection);
  const setSettingsSection = useUiStore((state) => state.setSettingsSection);
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

  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.settingsGet,
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
      // Older backends may omit this field until the desktop binary is rebuilt.
      proxy_enabled:
        typeof data.proxy_enabled === "boolean"
          ? data.proxy_enabled
          : Boolean(data.proxy_url?.trim()),
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

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await api.settingsSet(form);
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
      const message = status.online
        ? `Connected to ${status.hub_base_url}`
        : status.message || "Hub is not accessible.";
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
        queryClient.getQueryData<
          import("@nest/shared").InstalledPack[]
        >(queryKeys.installedPacks) ?? [];
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
          <Tabs
            value={settingsSection}
            onValueChange={(value) =>
              setSettingsSection(value as SettingsSection)
            }
            className="space-y-5"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="general">
                <Settings2 className="size-4" />
                General
              </TabsTrigger>
              <TabsTrigger value="account">
                <UserRound className="size-4" />
                Account
              </TabsTrigger>
            </TabsList>
            <TabsContent value="account">
              <HubAccountSettings />
            </TabsContent>
            <TabsContent value="general">
              <SettingsSection>
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
                        {(syncIndex.isPending ||
                          indexQuery.data?.is_indexing) && (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        )}
                        {syncIndex.isPending || indexQuery.data?.is_indexing
                          ? t("settings.syncing")
                          : t("settings.syncIndexNow")}
                      </Button>
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
                        <span className="font-mono">
                          openai/gpt-4o-mini
                        </span>
                        .
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
                <GeneralGroup icon={Cloud} title={t("settings.knowledgeHub")}>
                  <Field
                    label={t("settings.hubBaseUrl")}
                    description={t("settings.hubBaseUrlDescription")}
                  >
                    <Input
                      value={form.hub_base_url}
                      onChange={(e) => update("hub_base_url", e.target.value)}
                      placeholder="http://127.0.0.1:8787"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {hubTestResult ? (
                        <p
                          className={
                            hubTestResult.online
                              ? "text-xs text-primary"
                              : "text-xs text-destructive"
                          }
                        >
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
              </SettingsSection>
            </TabsContent>
          </Tabs>
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
                  <p className="truncate" title={pendingVaultChange?.current_path}>
                    From: {pendingVaultChange?.current_path}
                  </p>
                  <p className="mt-1 truncate" title={pendingVaultChange?.target_path}>
                    To: {pendingVaultChange?.target_path}
                  </p>
                </div>
                <p>
                  Migrate copies and verifies every managed pack before
                  removing its old folder. Start fresh removes the old managed
                  packs and installs new English and Simplified Chinese
                  Getting Started packs. Unrelated files in the old directory
                  are preserved.
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

function GeneralGroup({
  icon: Icon,
  title,
  help,
  children,
}: {
  icon: LucideIcon;
  title: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-4 text-primary" aria-hidden />
        {title}
        {help && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${title} configuration help`}
              >
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              align="start"
              className="max-w-80 normal-case leading-5 tracking-normal"
            >
              {help}
            </TooltipContent>
          </Tooltip>
        )}
      </h4>
      {children}
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
