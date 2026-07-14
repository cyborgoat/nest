import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings } from "@nest/shared";
import { Database } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

/** Matches backend default; not shown in UI — always forced on save. */
const DEFAULT_EMBEDDING_MODEL = "AllMiniLML6V2Q";

const EMPTY: AppSettings = {
  llm_base_url: "https://api.openai.com/v1",
  llm_api_key: "",
  chat_model: "gpt-4o-mini",
  embedding_model: DEFAULT_EMBEDDING_MODEL,
  hub_base_url: "http://127.0.0.1:8787",
};

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AppSettings>(EMPTY);

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: api.settingsGet,
  });

  const indexQuery = useQuery({
    queryKey: ["index-status"],
    queryFn: api.indexStatus,
    refetchInterval: (q) => (q.state.data?.is_indexing ? 1000 : false),
  });

  useEffect(() => {
    if (settingsQuery.data) setForm(settingsQuery.data);
  }, [settingsQuery.data]);

  const payload = (): AppSettings => ({
    ...form,
    embedding_model: DEFAULT_EMBEDDING_MODEL,
  });

  const save = useMutation({
    mutationFn: () => api.settingsSet(payload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error("Could not save settings", { description: e.message }),
  });

  const testLlm = useMutation({
    mutationFn: async () => {
      await api.settingsSet(payload());
      return api.settingsTestLlm();
    },
  });

  const testHub = useMutation({
    mutationFn: async () => {
      await api.settingsSet(payload());
      return api.settingsTestHub();
    },
  });

  const runTestLlm = () => {
    toast.promise(testLlm.mutateAsync(), {
      loading: "Testing LLM connection…",
      success: (msg) => msg || "LLM connection OK",
      error: (e: Error) => e.message || "LLM connection failed",
    });
  };

  const runTestHub = () => {
    toast.promise(testHub.mutateAsync(), {
      loading: "Testing Knowledge Hub…",
      success: (msg) => msg || "Knowledge Hub OK",
      error: (e: Error) => e.message || "Knowledge Hub connection failed",
    });
  };

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const busy =
    save.isPending || testLlm.isPending || testHub.isPending;

  return (
    <div className="space-y-6 p-4">
      <div>
        <h2 className="font-display text-xl">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure your OpenAI-compatible chat LLM and the Knowledge Hub URL.
          Retrieval uses a fixed on-device FastEmbed model.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">LLM</h3>
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
        <Button variant="outline" onClick={runTestLlm} disabled={busy}>
          {testLlm.isPending ? "Testing…" : "Test LLM connection"}
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Knowledge Hub</h3>
        <Field label="Hub base URL">
          <Input
            value={form.hub_base_url}
            onChange={(e) => update("hub_base_url", e.target.value)}
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          Remote catalog and pack downloads. Default is{" "}
          <span className="font-mono">http://127.0.0.1:8787</span>.
        </p>
        <Button variant="outline" onClick={runTestHub} disabled={busy}>
          {testHub.isPending ? "Testing…" : "Test Hub connection"}
        </Button>
      </section>

      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={busy}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Local index</h3>
        <p className="text-xs text-muted-foreground">
          Hybrid FTS + FastEmbed ({DEFAULT_EMBEDDING_MODEL}) over Markdown chunks.
          Rebuilds automatically when you download a knowledge pack from the Hub.
        </p>
        <div className="rounded-md border border-border bg-panel p-3 text-sm">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-primary" />
            <span>
              {indexQuery.data?.indexed_files ?? 0} files ·{" "}
              {indexQuery.data?.indexed_chunks ?? 0} chunks
            </span>
          </div>
          {indexQuery.data?.message && (
            <p className="mt-1 text-xs text-muted-foreground">
              {indexQuery.data.message}
            </p>
          )}
          {indexQuery.data?.is_indexing && (
            <p className="mt-1 text-xs text-accent">Indexing in progress…</p>
          )}
        </div>
      </section>
    </div>
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
