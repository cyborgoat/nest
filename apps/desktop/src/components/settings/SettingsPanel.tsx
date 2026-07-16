import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings } from "@nest/shared";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Bot,
  Cloud,
  FolderOpen,
  LoaderCircle,
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
import { api } from "@/lib/api";

/** Matches backend default; not shown in UI — always forced on save. */
const DEFAULT_EMBEDDING_MODEL = "AllMiniLML6V2Q";

const EMPTY: AppSettings = {
  llm_base_url: "https://api.openai.com/v1",
  llm_api_key: "",
  chat_model: "gpt-4o-mini",
  embedding_model: DEFAULT_EMBEDDING_MODEL,
  hub_base_url: "",
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
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AppSettings>(EMPTY);
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
    const initial = withFixedEmbedding(settingsQuery.data);
    setForm(initial);
    lastSavedKey.current = persistKey(initial);
    hydrated.current = true;
  }, [settingsQuery.data]);

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
            resolved_knowledge_dir: refreshed.resolved_knowledge_dir,
          }));
          queryClient.setQueryData(["settings"], refreshed);
          void queryClient.invalidateQueries({ queryKey: ["hub-status"] });
          void queryClient.invalidateQueries({ queryKey: ["packs"] });
          void queryClient.invalidateQueries({ queryKey: ["tree"] });
          void queryClient.invalidateQueries({ queryKey: ["installed-packs"] });
        } catch (e) {
          toast.error("Could not save settings", {
            description: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [form, queryClient]);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (key === "hub_base_url") setHubTestResult(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const testHubConnection = useMutation({
    mutationFn: () => api.hubTestConnection(form.hub_base_url),
    onSuccess: (status) => {
      const message = status.online
        ? `Connected to ${status.hub_base_url}`
        : status.message || "Knowledge Hub is not accessible.";
      setHubTestResult({ online: status.online, message });
      if (status.online) {
        toast.success("Knowledge Hub connected", { description: message });
      } else {
        toast.error("Knowledge Hub connection failed", { description: message });
      }
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      setHubTestResult({ online: false, message });
      toast.error("Could not test Knowledge Hub", { description: message });
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
      toast.error("Could not open folder picker", {
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
        title="Settings"
        description="Changes save automatically. Connection problems show up when you chat or open the Hub."
      />
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl space-y-6 px-6 py-5">
        <SettingsSection
          icon={User}
          title="Personal"
          description="How Nest addresses you and where packs are stored."
        >
          <Field label="Your name">
            <Input
              value={form.user_name}
              onChange={(e) => update("user_name", e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Local knowledge directory">
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
                Browse
              </Button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {usingDefaultKnowledge
                  ? "Using the app default vault folder."
                  : "Using a custom folder. Re-indexes automatically."}
              </p>
              {!usingDefaultKnowledge && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => update("knowledge_dir", "")}
                >
                  Reset to default
                </Button>
              )}
            </div>
          </Field>
        </SettingsSection>

        <SettingsSection
          icon={Bot}
          title="LLM"
          description="OpenAI-compatible chat API used for answers and titles."
        >
          <Field label="Base URL">
            <Input
              value={form.llm_base_url}
              onChange={(e) => update("llm_base_url", e.target.value)}
            />
          </Field>
          <Field label="API key">
            <Input
              type="password"
              value={form.llm_api_key}
              onChange={(e) => update("llm_api_key", e.target.value)}
              placeholder="sk-…"
            />
          </Field>
          <Field label="Chat model">
            <Input
              value={form.chat_model}
              onChange={(e) => update("chat_model", e.target.value)}
            />
          </Field>
        </SettingsSection>

        <SettingsSection
          icon={Cloud}
          title="Knowledge Hub"
          description="Remote catalog for pack downloads."
        >
          <Field label="Hub base URL">
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
                {testHubConnection.isPending ? "Testing…" : "Test connection"}
              </Button>
            </div>
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
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
