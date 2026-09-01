import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppSettings,
  ClaudeConnectionReport,
  ClaudeDetectionDto,
} from "@nest/shared";
import { AlertCircle, CheckCircle2, LoaderCircle, Sparkles, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  ClaudeModelsEditor,
  type ModelRowStatuses,
} from "./ClaudeModelsEditor";
import { parseModelRows, serializeModelRows } from "./model-rows";
import { GeneralGroup } from "./GeneralGroup";

type ClaudeDraft = {
  enabled: boolean;
  cliPath: string;
  customModels: string;
};

function useClaudeAgentSettings(settingsQuery: {
  data: AppSettings | undefined;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ClaudeDraft>({
    enabled: false,
    cliPath: "",
    customModels: "",
  });
  const [modelRows, setModelRows] = useState<string[]>([""]);
  const [hydrated, setHydrated] = useState(false);
  const [testResult, setTestResult] = useState<ClaudeConnectionReport | null>(
    null,
  );
  const [stale, setStale] = useState(false);
  const [detection, setDetection] = useState<ClaudeDetectionDto | null>(null);
  const [detectFailed, setDetectFailed] = useState(false);
  const [testingModel, setTestingModel] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsQuery.data || hydrated) return;
    const customModels = settingsQuery.data.claude_custom_models ?? "";
    setDraft({
      enabled: settingsQuery.data.claude_agent_enabled ?? false,
      cliPath: settingsQuery.data.claude_cli_path ?? "",
      customModels,
    });
    setModelRows(parseModelRows(customModels));
    setHydrated(true);
  }, [settingsQuery.data, hydrated]);

  const connectionQuery = useQuery({
    queryKey: queryKeys.claudeConnection,
    queryFn: api.claudeConnectionStatus,
  });

  const statusesQuery = useQuery({
    queryKey: [...queryKeys.claudeModelStatuses, draft.cliPath.trim()],
    queryFn: () => api.claudeModelStatuses(draft.cliPath.trim()),
  });

  const serializedModels = serializeModelRows(modelRows);
  const dirty =
    hydrated &&
    (draft.enabled !== (settingsQuery.data?.claude_agent_enabled ?? false) ||
      draft.cliPath !== (settingsQuery.data?.claude_cli_path ?? "") ||
      serializedModels !==
        (settingsQuery.data?.claude_custom_models ?? ""));

  const markDirty = () => setStale(true);

  const detect = useMutation({
    mutationFn: () => api.claudeDetectCli(draft.cliPath.trim() || undefined),
    onSuccess: (result) => {
      setDetection(result);
      setDetectFailed(false);
      setDraft((prev) => ({ ...prev, cliPath: result.resolved_path }));
      markDirty();
    },
    onError: () => {
      setDetection(null);
      setDetectFailed(true);
    },
  });

  const test = useMutation({
    mutationFn: () => api.claudeTestConnection(draft.cliPath),
    onSuccess: (report) => {
      setTestResult(report);
      setDetectFailed(false);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.claudeConnection,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.claudeModelOptions,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatBackendDescriptors,
      });
    },
    onError: (e: unknown) => {
      toast.error(t("settings.claude.couldNotTest"), {
        description: e instanceof Error ? e.message : String(e),
      });
    },
  });

  const testModel = useMutation({
    mutationFn: ({
      cliPath,
      model,
    }: {
      cliPath: string;
      model: string;
    }) => api.claudeTestModel(cliPath, model),
    onMutate: ({ model }) => {
      setTestingModel(model.trim());
    },
    onSuccess: () => {
      setTestingModel(null);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.claudeModelStatuses,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatBackendDescriptors,
      });
    },
    onError: () => {
      setTestingModel(null);
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api.claudeSaveSettings({
        enabled: draft.enabled,
        cliPath: draft.cliPath,
        customModels: serializedModels,
      }),
    onSuccess: (report) => {
      setTestResult(
        report.status === "connected" ? report : null,
      );
      setStale(false);
      setDetectFailed(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.claudeConnection,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.claudeModelOptions,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatSessions });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.chatBackendDescriptors,
      });
      if (report.status === "connected") {
        toast.success(t("settings.claude.statusConnected"));
      } else if (report.status === "disabled") {
        toast.success(t("settings.claude.statusDisabled"));
      } else {
        toast.error(t("settings.claude.statusDisconnected"), {
          description:
            report.message ?? `probe status: ${report.status ?? "unknown"}`,
        });
      }
    },
    onError: (e: unknown) => {
      toast.error(t("settings.claude.couldNotSave"), {
        description: e instanceof Error ? e.message : String(e),
      });
    },
  });

  const matchingTestResult =
    testResult?.configured_cli_path === draft.cliPath.trim()
      ? testResult
      : null;

  const persistedStatus =
    stale || matchingTestResult
      ? null
      : connectionQuery.data &&
          connectionQuery.data.configured_cli_path === draft.cliPath.trim()
        ? connectionQuery.data
        : null;

  const defaultModelReport =
    matchingTestResult ??
    (connectionQuery.data &&
    connectionQuery.data.configured_cli_path === draft.cliPath.trim()
      ? connectionQuery.data
      : null);
  const defaultModel = (defaultModelReport?.effective_model ?? "").trim();

  const savedModels = new Set(
    (settingsQuery.data?.claude_custom_models ?? "")
      .split("\n")
      .map((model) => model.trim())
      .filter((model) => model !== ""),
  );

  const persistedRowStatuses: ModelRowStatuses = {};
  for (const [model, entry] of Object.entries(statusesQuery.data ?? {})) {
    if (entry.configured_cli_path !== draft.cliPath.trim()) continue;
    persistedRowStatuses[model] = {
      ok: entry.ok,
      message: entry.ok
        ? t("settings.claude.modelTestedAt", {
            time: entry.tested_at.replace("T", " ").slice(0, 19),
          })
        : entry.message,
    };
  }

  const saveRowAndTest = (index: number) => {
    const model = modelRows[index]?.trim();
    if (!model || save.isPending) return;
    save.mutate(undefined, {
      onSuccess: () => {
        testModel.mutate({ cliPath: draft.cliPath, model });
      },
    });
  };

  const clearPathFeedback = () => {
    setDetection(null);
    setDetectFailed(false);
    setTestResult(null);
  };

  return {
    draft,
    setDraft,
    modelRows,
    setModelRows,
    detect,
    test,
    testModel,
    testingModel,
    persistedRowStatuses,
    savedModels,
    saveRowAndTest,
    save,
    dirty,
    markDirty,
    testResult: matchingTestResult,
    persistedStatus,
    defaultModel,
    detectFailed,
    detection,
    clearPathFeedback,
  };
}

export function ClaudeAgentSettingsSection({
  settingsQuery,
}: {
  settingsQuery: { data: AppSettings | undefined };
}) {
  const { t } = useI18n();
  const {
    draft,
    setDraft,
    modelRows,
    setModelRows,
    detect,
    test,
    testModel,
    testingModel,
    persistedRowStatuses,
    savedModels,
    saveRowAndTest,
    save,
    dirty,
    markDirty,
    testResult,
    persistedStatus,
    defaultModel,
    detectFailed,
    detection,
    clearPathFeedback,
  } = useClaudeAgentSettings(settingsQuery);

  const displayReport = testResult ?? persistedStatus;
  const reportConnected =
    displayReport?.status === "connected" ||
    displayReport?.status === "last_connected";
  const featureDisabled = !draft.enabled;
  const localOperationPending =
    detect.isPending || test.isPending || testModel.isPending || save.isPending;
  const mergedRowStatuses =
    testingModel != null
      ? { ...persistedRowStatuses, [testingModel]: "testing" as const }
      : persistedRowStatuses;

  return (
    <GeneralGroup
      icon={Sparkles}
      title={t("settings.claude.group")}
      help={<p>{t("settings.claude.groupDescription")}</p>}
      action={
        <Button
          type="button"
          size="sm"
          variant={dirty ? "default" : "outline"}
          className={cn("shrink-0", dirty && "animate-pulse")}
          disabled={localOperationPending}
          onClick={() => save.mutate()}
        >
          {save.isPending && (
            <LoaderCircle className="size-3.5 animate-spin" />
          )}
          {save.isPending
            ? t("settings.claude.saving")
            : draft.enabled
              ? t("settings.claude.saveAndConnect")
              : t("settings.claude.save")}
        </Button>
      }
    >
      {dirty && (
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/40 bg-primary/[0.08] px-3 py-2.5 shadow-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">
              {t("settings.claude.unsavedChanges")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("settings.claude.unsavedChangesDescription")}
            </p>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/40 px-3 py-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="claude-enabled" className="text-sm font-medium">
            {t("settings.claude.enabled")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.claude.enabledDescription")}
          </p>
        </div>
        <Switch
          id="claude-enabled"
          checked={draft.enabled}
          onCheckedChange={(checked) => {
            setDraft((prev) => ({ ...prev, enabled: checked }));
            markDirty();
          }}
          aria-label={t("settings.claude.enabled")}
          disabled={localOperationPending}
        />
      </div>
      <Field
        label={t("settings.claude.cliPath")}
        description={t("settings.claude.cliPathDescription")}
      >
        <div className="flex min-w-0 gap-2">
          <Input
            value={draft.cliPath}
            onChange={(e) => {
              setDraft((prev) => ({ ...prev, cliPath: e.target.value }));
              clearPathFeedback();
              markDirty();
            }}
            placeholder={
              detectFailed
                ? t("settings.claude.detectionFailedPlaceholder")
                : "claude.exe · cli-wrapper.cjs · empty = auto-detect"
            }
            disabled={featureDisabled || localOperationPending}
            className={cn(
              "min-w-0 flex-1 font-mono text-xs",
              detectFailed && !draft.cliPath.trim() && "border-destructive",
            )}
          />
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={featureDisabled || localOperationPending}
            onClick={() => detect.mutate()}
          >
            {detect.isPending && (
              <LoaderCircle className="size-4 animate-spin" />
            )}
            {detect.isPending
              ? t("settings.claude.detecting")
              : t("settings.claude.autoDetect")}
          </Button>
        </div>
        {!detect.isPending && detection && (
          <p className="flex items-center gap-1.5 text-xs text-primary">
            <CheckCircle2 className="size-3.5 shrink-0" />
            {t("settings.claude.detectionSucceeded", {
              version: detection.cli_version ?? "?",
              strategy: detection.spawn_strategy,
            })}
          </p>
        )}
        {!detect.isPending && detectFailed && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <XCircle className="size-3.5 shrink-0" />
            {t("settings.claude.detectionFailed")}
          </p>
        )}
      </Field>
      <Field
        label={t("settings.claude.testConnection")}
        description={t("settings.claude.testConnectionDescription")}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={featureDisabled || localOperationPending}
            onClick={() => test.mutate()}
          >
            {test.isPending && (
              <LoaderCircle className="size-3.5 animate-spin" />
            )}
            {test.isPending
              ? t("settings.testing")
              : t("settings.claude.testConnection")}
          </Button>
        </div>
        {displayReport && (
          <div className="space-y-1 rounded-md border bg-muted/30 px-3 py-2">
            <p
              className={
                reportConnected
                  ? "flex items-center gap-1.5 text-xs text-primary"
                  : "flex items-center gap-1.5 text-xs text-destructive"
              }
            >
              {reportConnected ? (
                <CheckCircle2 className="size-3.5 shrink-0" />
              ) : (
                <XCircle className="size-3.5 shrink-0" />
              )}
              {reportConnected
                ? displayReport.status === "last_connected"
                  ? t("settings.claude.statusLastConnected")
                  : t("settings.claude.statusConnected")
                : (displayReport.message ??
                  t("settings.claude.statusDisconnected"))}
            </p>
            {reportConnected && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <dt>{t("settings.claude.resolvedPath")}</dt>
                <dd className="truncate font-mono">
                  {displayReport.resolved_cli_path}
                </dd>
                <dt>{t("settings.claude.cliVersion")}</dt>
                <dd className="font-mono">{displayReport.cli_version}</dd>
                <dt>{t("settings.claude.effectiveModel")}</dt>
                <dd className="font-mono">
                  {displayReport.effective_model}
                </dd>
                <dt>{t("settings.claude.testedAt")}</dt>
                <dd className="font-mono">{displayReport.tested_at}</dd>
              </dl>
            )}
          </div>
        )}
      </Field>
      <Field
        label={t("settings.claude.customModels")}
        description={t("settings.claude.customModelsDescription")}
      >
        <ClaudeModelsEditor
          rows={modelRows}
          disabled={featureDisabled || localOperationPending}
          defaultModel={defaultModel}
          savedModels={savedModels}
          rowStatuses={mergedRowStatuses}
          onTestRow={(index) => {
            const model = modelRows[index]?.trim();
            if (!model) return;
            testModel.mutate({ cliPath: draft.cliPath, model });
          }}
          onSaveRow={saveRowAndTest}
          onChange={(rows) => {
            setModelRows(rows);
            markDirty();
          }}
        />
      </Field>
    </GeneralGroup>
  );
}
