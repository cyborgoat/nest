import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings } from "@nest/shared";
import { Database } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useUiStore } from "@/stores/ui";

const EMPTY: AppSettings = {
  llm_base_url: "https://api.openai.com/v1",
  llm_api_key: "",
  chat_model: "gpt-4o-mini",
  embedding_model: "AllMiniLML6V2Q",
  hub_base_url: "http://127.0.0.1:8787",
};

export function SettingsPanel() {
  const setStatusMessage = useUiStore((s) => s.setStatusMessage);
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

  const save = useMutation({
    mutationFn: () => api.settingsSet(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setStatusMessage("Settings saved");
    },
    onError: (e: Error) => setStatusMessage(e.message),
  });

  const test = useMutation({
    mutationFn: async () => {
      await api.settingsSet(form);
      return api.settingsTestConnection();
    },
    onSuccess: (msg) => setStatusMessage(msg),
    onError: (e: Error) => setStatusMessage(e.message),
  });

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-6 p-4">
      <div>
        <h2 className="font-display text-xl">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure your OpenAI-compatible chat LLM. Retrieval uses local FastEmbed + SQLite
          vectors (offline).
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
        <Field label="Local embedding model">
          <Input
            value={form.embedding_model}
            onChange={(e) => update("embedding_model", e.target.value)}
            placeholder="AllMiniLML6V2Q"
          />
        </Field>
        <p className="text-xs text-muted-foreground">
          FastEmbed models run on-device (e.g. AllMiniLML6V2Q, BGESmallENV15Q). First index after
          a pack download may download ONNX weights. Chat still uses the LLM base URL above.
        </p>
        <Field label="Hub base URL">
          <Input
            value={form.hub_base_url}
            onChange={(e) => update("hub_base_url", e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            Test connection
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Local index</h3>
        <p className="text-xs text-muted-foreground">
          Hybrid FTS + FastEmbed vector index over Markdown chunks. Rebuilds automatically when you
          download a knowledge pack from the Hub.
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
