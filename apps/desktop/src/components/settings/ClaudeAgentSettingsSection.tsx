import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppSettings,
  ClaudeConnectionReport,
  ClaudeDetectionDto,
} from "@nest/shared";
import { CheckCircle2, PlugZap, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  ClaudeModelsEditor,
  type ModelRowStatuses,
} from "./ClaudeModelsEditor";
import { parseModelRows, serializeModelRows } from "./model-rows";

type ClaudeDraft = {
  enabled: boolean;
  cliPath: string;
  customArgs: string;
  customModels: string;
};

type SaveOptions = {
  silent?: boolean;
  revision?: string;
  snapshot?: ClaudeDraft;
};

function useClaudeAgentSettings(settingsQuery: {
  data: AppSettings | undefined;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ClaudeDraft>({
    enabled: false,
    cliPath: "",
    customArgs: "",
    customModels: "",
  });
  const [modelRows, setModelRows] = useState<string[]>([""]);
  const [savedDraft, setSavedDraft] = useState<ClaudeDraft | null>(null);
  const [failedAutoSaveRevision, setFailedAutoSaveRevision] = useState<
    string | null
  >(null);
  const [hydrated, setHydrated] = useState(false);
  const [testResult, setTestResult] = useState<ClaudeConnectionReport | null>(
    null,
  );
  const [stale, setStale] = useState(false);
  const [detection, setDetection] = useState<ClaudeDetectionDto | null>(null);
  const [detectFailed, setDetectFailed] = useState(false);

  useEffect(() => {
    if (!settingsQuery.data || hydrated) return;
    const customModels = settingsQuery.data.claude_custom_models ?? "";
    const initialDraft = {
      enabled: settingsQuery.data.claude_agent_enabled ?? false,
      cliPath: settingsQuery.data.claude_cli_path ?? "",
      customArgs: settingsQuery.data.claude_custom_args ?? "",
      customModels,
    };
    setDraft(initialDraft);
    setSavedDraft(initialDraft);
    setModelRows(parseModelRows(customModels));
    setHydrated(true);
  }, [settingsQuery.data, hydrated]);

  const connectionQuery = useQuery({
    queryKey: queryKeys.claudeConnection,
    queryFn: api.claudeConnectionStatus,
    enabled: hydrated && draft.enabled,
  });

  const statusesQuery = useQuery({
    queryKey: [
      ...queryKeys.claudeModelStatuses,
      draft.cliPath.trim(),
      draft.customArgs.trim(),
    ],
    queryFn: () =>
      api.claudeModelStatuses(draft.cliPath.trim(), draft.customArgs.trim()),
    enabled: hydrated && draft.enabled,
  });

  const serializedModels = serializeModelRows(modelRows);
  const currentSnapshot = {
    ...draft,
    customModels: serializedModels,
  };
  const revision = JSON.stringify(currentSnapshot);
  const dirty =
    hydrated &&
    savedDraft !== null &&
    (draft.enabled !== savedDraft.enabled ||
      draft.cliPath !== savedDraft.cliPath ||
      draft.customArgs !== savedDraft.customArgs ||
      serializedModels !== savedDraft.customModels);

  const markDirty = () => setStale(true);

  const detect = useMutation({
    mutationFn: () =>
      api.claudeDetectCli(
        draft.cliPath.trim() || undefined,
        draft.customArgs.trim(),
      ),
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
    mutationFn: () =>
      api.claudeTestConnection(draft.cliPath, draft.customArgs),
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

  const save = useMutation({
    mutationFn: (options?: SaveOptions) => {
      const snapshot = options?.snapshot ?? currentSnapshot;
      return api.claudeSaveSettings({
        enabled: snapshot.enabled,
        cliPath: snapshot.cliPath,
        customArgs: snapshot.customArgs,
        customModels: snapshot.customModels,
      });
    },
    onSuccess: (report, options) => {
      const snapshot = options?.snapshot ?? currentSnapshot;
      setSavedDraft(snapshot);
      setFailedAutoSaveRevision(null);
      setTestResult(report.status === "connected" ? report : null);
      setStale(false);
      setDetectFailed(false);
      queryClient.setQueryData<AppSettings>(queryKeys.settings, (current) =>
        current
          ? {
              ...current,
              claude_agent_enabled: snapshot.enabled,
              claude_cli_path: snapshot.cliPath,
              claude_custom_args: snapshot.customArgs,
              claude_custom_models: snapshot.customModels,
            }
          : current,
      );
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
      if (options?.silent) {
        return;
      }
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
    onError: (e: unknown, options) => {
      if (options?.silent) {
        setFailedAutoSaveRevision(options.revision ?? null);
      }
      toast.error(t("settings.claude.couldNotSave"), {
        description: e instanceof Error ? e.message : String(e),
      });
    },
  });

  const autoSave = save.mutate;
  useEffect(() => {
    if (
      !hydrated ||
      !dirty ||
      save.isPending ||
      failedAutoSaveRevision === revision
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      autoSave({
        silent: true,
        revision,
        snapshot: JSON.parse(revision) as ClaudeDraft,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    autoSave,
    dirty,
    draft.cliPath,
    draft.customArgs,
    draft.enabled,
    failedAutoSaveRevision,
    hydrated,
    revision,
    save.isPending,
    serializedModels,
  ]);

  const matchingTestResult =
    testResult?.configured_cli_path === draft.cliPath.trim() &&
    testResult.configured_cli_args === draft.customArgs.trim()
      ? testResult
      : null;

  const persistedStatus =
    stale || matchingTestResult
      ? null
      : connectionQuery.data &&
          connectionQuery.data.configured_cli_path === draft.cliPath.trim() &&
          connectionQuery.data.configured_cli_args === draft.customArgs.trim()
        ? connectionQuery.data
        : null;

  const defaultModelReport =
    matchingTestResult ??
    (connectionQuery.data &&
    connectionQuery.data.configured_cli_path === draft.cliPath.trim() &&
    connectionQuery.data.configured_cli_args === draft.customArgs.trim()
      ? connectionQuery.data
      : null);
  const defaultModel = (defaultModelReport?.effective_model ?? "").trim();

  const persistedRowStatuses: ModelRowStatuses = {};
  for (const [model, entry] of Object.entries(statusesQuery.data ?? {})) {
    if (entry.configured_cli_path !== draft.cliPath.trim()) continue;
    if ((entry.configured_cli_args ?? "") !== draft.customArgs.trim()) continue;
    persistedRowStatuses[model] = {
      ok: entry.ok,
      message: entry.ok
        ? t("settings.claude.modelTestedAt", {
            time: entry.tested_at.replace("T", " ").slice(0, 19),
          })
        : entry.message,
    };
  }

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
    persistedRowStatuses,
    save,
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
    persistedRowStatuses,
    save,
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
    detect.isPending || test.isPending || save.isPending;

  return (
    <div className="space-y-4 border-t border-border/60 pt-4">
      <div className="space-y-1">
        <div className="min-w-0 space-y-1">
          <h5 className="text-sm font-medium">{t("settings.claude.group")}</h5>
          <p className="text-xs text-muted-foreground">
            {t("settings.claude.groupDescription")}
          </p>
        </div>
      </div>
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
          className="data-[state=checked]:border-neutral-800 data-[state=checked]:bg-neutral-800"
          checked={draft.enabled}
          onCheckedChange={(checked) => {
            setDraft((prev) => ({ ...prev, enabled: checked }));
            markDirty();
          }}
          aria-label={t("settings.claude.enabled")}
          disabled={localOperationPending}
        />
      </div>
      {draft.enabled && (
        <div className="space-y-4">
      <Field
        label={t("settings.claude.cliPath")}
        description={t("settings.claude.cliPathDescription")}
      >
        <div className="flex min-w-0 items-center gap-2">
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
            variant="settings"
            size="settings"
            className="shrink-0"
            disabled={featureDisabled || localOperationPending}
            onClick={() => detect.mutate()}
          >
            {detect.isPending && <Spinner data-icon="inline-start" />}
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
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="settings"
                size="icon-sm"
                disabled={featureDisabled || localOperationPending}
                onClick={() => test.mutate()}
                aria-label={
                  test.isPending
                    ? t("settings.testing")
                    : t("settings.claude.testConnection")
                }
              >
                {test.isPending ? (
                  <Spinner />
                ) : (
                  <PlugZap className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t("settings.claude.testConnection")}
            </TooltipContent>
          </Tooltip>
        }
      >
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
          rowStatuses={persistedRowStatuses}
          onChange={(rows) => {
            setModelRows(rows);
            markDirty();
          }}
        />
      </Field>
      <Field
        label={t("settings.claude.customStartupArgs")}
        description={t("settings.claude.customStartupArgsDescription")}
      >
        <Input
          value={draft.customArgs}
          onChange={(event) => {
            setDraft((prev) => ({ ...prev, customArgs: event.target.value }));
            clearPathFeedback();
            markDirty();
          }}
          placeholder="--skip-safe-check"
          disabled={featureDisabled || localOperationPending}
          className="font-mono text-xs"
        />
      </Field>
        </div>
      )}
    </div>
  );
}
