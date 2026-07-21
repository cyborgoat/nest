import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings } from "@nest/shared";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Bot,
  Cloud,
  FolderOpen,
  LoaderCircle,
  Network,
  Palette,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Matches backend default; not shown in UI — always forced on save. */
const DEFAULT_EMBEDDING_MODEL = "AllMiniLML6V2Q";
const MIN_FONT_SIZE_PT = 6;
const MAX_FONT_SIZE_PT = 24;

const EMPTY: AppSettings = {
  llm_base_url: "https://api.openai.com/v1",
  llm_api_key: "",
  chat_model: "gpt-4o-mini",
  embedding_model: DEFAULT_EMBEDDING_MODEL,
  hub_base_url: "",
  proxy_url: "",
  proxy_enabled: false,
  font_size_pt: 10,
  display_language: "en",
  user_name: "",
  knowledge_dir: "",
  resolved_knowledge_dir: "",
};

function withFixedEmbedding(settings: AppSettings): AppSettings {
  return { ...settings, embedding_model: DEFAULT_EMBEDDING_MODEL };
}

/** Persist payload omits transient resolved path differences for dirty checks. */
function persistKey(settings: AppSettings): string {
  const { resolved_knowledge_dir: _, ...rest } = withFixedEmbedding(settings);
  return JSON.stringify(rest);
}

export function SettingsPanel() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AppSettings>(EMPTY);
  const [fontSizeDraft, setFontSizeDraft] = useState(String(EMPTY.font_size_pt));
  const [hubTestResult, setHubTestResult] = useState<{
    online: boolean;
    message: string;
  } | null>(null);
  const hydrated = useRef(false);
  const lastSavedKey = useRef("");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: api.settingsGet,
  });

  useEffect(() => {
    if (!settingsQuery.data || hydrated.current) return;
    const data = settingsQuery.data;
    const initial = withFixedEmbedding({
      ...EMPTY,
      ...data,
      // Older backends may omit this field until the desktop binary is rebuilt.
      proxy_enabled:
        typeof data.proxy_enabled === "boolean"
          ? data.proxy_enabled
          : Boolean(data.proxy_url?.trim()),
    });
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
    const next = withFixedEmbedding(form);
    const key = persistKey(next);
    if (key === lastSavedKey.current) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await api.settingsSet(next);
          const refreshed = await api.settingsGet();
          lastSavedKey.current = persistKey(refreshed);
          setForm((prev) => ({
            ...prev,
            font_size_pt: refreshed.font_size_pt,
            display_language: refreshed.display_language,
            resolved_knowledge_dir: refreshed.resolved_knowledge_dir,
          }));
          queryClient.setQueryData(["settings"], refreshed);
          void queryClient.invalidateQueries({ queryKey: ["hub-status"] });
          void queryClient.invalidateQueries({ queryKey: ["packs"] });
          void queryClient.invalidateQueries({ queryKey: ["tree"] });
          void queryClient.invalidateQueries({ queryKey: ["installed-packs"] });
        } catch (e) {
          toast.error(t("settings.couldNotSave"), {
            description: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [form, queryClient, t]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (key === "hub_base_url" || key === "proxy_url" || key === "proxy_enabled") {
      setHubTestResult(null);
    }
    setForm((prev) => ({ ...prev, [key]: value }));
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

  const pickKnowledgeDir = async () => {
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose knowledge directory",
      });
      if (typeof result === "string" && result) {
        update("knowledge_dir", result);
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
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-5">
          <SettingsSection
            icon={User}
            title={t("settings.personal")}
            description={t("settings.personalDescription")}
          >
            <Field
              label={t("settings.yourName")}
              description={t("settings.yourNameDescription")}
            >
              <Input
                value={form.user_name}
                onChange={(e) => update("user_name", e.target.value)}
                placeholder={t("settings.optional")}
              />
            </Field>
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
                    onClick={() => update("knowledge_dir", "")}
                  >
                    {t("settings.resetToDefault")}
                  </Button>
                )}
              </div>
            </Field>
          </SettingsSection>

          <SettingsSection
            icon={Palette}
            title={t("settings.appearance")}
            description={t("settings.appearanceDescription")}
          >
            <Field
              label={t("settings.fontSize")}
              description={t("settings.fontSizeDescription")}
            >
              <div className="space-y-2">
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
              </div>
            </Field>
          </SettingsSection>

          <SettingsSection
            icon={Bot}
            title={t("settings.llm")}
            description={t("settings.llmDescription")}
          >
            <Field
              label={t("settings.baseUrl")}
              description={t("settings.baseUrlDescription")}
            >
              <Input
                value={form.llm_base_url}
                onChange={(e) => update("llm_base_url", e.target.value)}
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
            </Field>
            <Field
              label={t("settings.chatModel")}
              description={t("settings.chatModelDescription")}
            >
              <Input
                value={form.chat_model}
                onChange={(e) => update("chat_model", e.target.value)}
              />
            </Field>
          </SettingsSection>

          <SettingsSection
            icon={Cloud}
            title={t("settings.knowledgeHub")}
            description={t("settings.knowledgeHubDescription")}
          >
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
          </SettingsSection>

          <SettingsSection
            icon={Network}
            title={t("settings.network")}
            description={t("settings.networkDescription")}
          >
            <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-background px-3 py-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="proxy-enabled" className="text-sm font-medium">
                  {t("settings.proxyEnabled")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.proxyEnabledDescription")}
                </p>
              </div>
              <Switch
                id="proxy-enabled"
                checked={Boolean(form.proxy_enabled)}
                onCheckedChange={(checked) => update("proxy_enabled", checked)}
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
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
        </h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        {children}
      </div>
    </section>
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
