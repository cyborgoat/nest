import { CheckCircle2, LoaderCircle, Plus, X, XCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { isDuplicateRow } from "./model-rows";

export type ModelRowStatus = "idle" | "testing" | "ok" | "fail";
export type ModelRowOutcome = { ok: boolean; message: string | null };
export type ModelRowStatuses = Record<string, ModelRowStatus | ModelRowOutcome>;

export function ClaudeModelsEditor({
  rows,
  disabled = false,
  defaultModel = "",
  savedModels,
  rowStatuses,
  onTestRow,
  onSaveRow,
  onChange,
}: {
  rows: string[];
  disabled?: boolean;
  defaultModel?: string;
  savedModels?: Set<string>;
  rowStatuses?: ModelRowStatuses;
  onTestRow?: (index: number) => void;
  onSaveRow?: (index: number) => void;
  onChange: (rows: string[]) => void;
}) {
  const { t } = useI18n();
  const lastRowRef = useRef<HTMLInputElement | null>(null);
  const shouldFocusNewRow = useRef(false);

  useEffect(() => {
    if (shouldFocusNewRow.current) {
      shouldFocusNewRow.current = false;
      lastRowRef.current?.focus();
    }
  }, [rows.length]);

  const updateRow = (index: number, value: string) => {
    const next = [...rows];
    next[index] = value;
    onChange(next);
  };

  const removeRow = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    if (next.length === 0) {
      next.push("");
    }
    onChange(next);
  };

  const addRow = () => {
    onChange([...rows, ""]);
    shouldFocusNewRow.current = true;
  };

  const statusOf = (row: string): ModelRowStatus => {
    const status = rowStatuses?.[row.trim()];
    if (status == null) return "idle";
    if (typeof status === "string") return status;
    return status.ok ? "ok" : "fail";
  };

  const statusMessageOf = (row: string): string | null => {
    const status = rowStatuses?.[row.trim()];
    if (status == null || typeof status === "string") return null;
    return status.message;
  };

  const actionFor = (row: string): "test" | "save" => {
    const trimmed = row.trim();
    if (trimmed === "") return "test";
    return savedModels?.has(trimmed) === false ? "save" : "test";
  };

  return (
    <div className="space-y-2">
      {defaultModel.trim() !== "" && (
        <ModelRow
          label={t("settings.claude.defaultModelLabel")}
          value={defaultModel}
          disabled
          status="ok"
          actionLabel={t("settings.claude.defaultModelAction")}
          actionDisabled
          removeDisabled
        />
      )}
      {rows.map((row, index) => {
        const duplicate = isDuplicateRow(rows, index);
        const action = actionFor(row);
        return (
          <ModelRow
            key={index}
            label={t("settings.claude.modelRowLabel", { index: index + 1 })}
            removeLabel={t("settings.claude.removeModelRow", {
              index: index + 1,
            })}
            value={row}
            disabled={disabled}
            placeholder={
              defaultModel.trim() === ""
                ? t("settings.claude.customModelsHint")
                : ""
            }
            duplicate={duplicate}
            status={statusOf(row)}
            statusMessage={statusMessageOf(row)}
            actionLabel={
              action === "save"
                ? t("settings.claude.save")
                : t("settings.claude.testModel")
            }
            onAction={() => {
              if (row.trim() === "") return;
              if (action === "save") {
                onSaveRow?.(index);
              } else {
                onTestRow?.(index);
              }
            }}
            onRemove={() => removeRow(index)}
            inputRef={index === rows.length - 1 ? lastRowRef : undefined}
            onChange={(value) => updateRow(index, value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (row.trim() !== "" && index === rows.length - 1) {
                  addRow();
                }
              }
            }}
          />
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={addRow}
      >
        <Plus className="size-3.5" />
        {t("settings.claude.addModel")}
      </Button>
    </div>
  );
}

function ModelRow({
  label,
  removeLabel,
  value,
  disabled,
  placeholder,
  duplicate,
  status,
  statusMessage,
  actionLabel,
  actionDisabled,
  removeDisabled,
  inputRef,
  onAction,
  onRemove,
  onChange,
  onKeyDown,
}: {
  label: string;
  removeLabel?: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  duplicate?: boolean;
  status: ModelRowStatus;
  statusMessage?: string | null;
  actionLabel: string;
  actionDisabled?: boolean;
  removeDisabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  onAction?: () => void;
  onRemove?: () => void;
  onChange?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { t } = useI18n();
  const statusTitle =
    status === "testing"
      ? t("settings.claude.testingModel")
      : status === "ok"
        ? (statusMessage ?? t("settings.claude.modelAvailable"))
        : status === "fail"
          ? (statusMessage ?? t("settings.claude.modelUnavailable"))
          : undefined;
  const statusIcon =
    status === "testing" ? (
      <LoaderCircle
        className="size-3.5 animate-spin text-primary"
        aria-label={t("settings.claude.testingModel")}
      />
    ) : status === "ok" ? (
      <CheckCircle2
        className="size-3.5 text-success"
        aria-label={t("settings.claude.modelAvailable")}
      />
    ) : status === "fail" ? (
      <XCircle
        className="size-3.5 cursor-help text-destructive"
        aria-label={t("settings.claude.modelUnavailable")}
      />
    ) : null;
  return (
    <div className="min-w-0 space-y-1">
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
        <Input
          ref={inputRef}
          value={value}
          disabled={disabled}
          readOnly={!onChange}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={label}
          placeholder={placeholder}
          className="min-w-0 font-mono text-xs"
        />
        <span className="flex w-4 shrink-0 items-center justify-center">
          {statusTitle ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center">{statusIcon}</span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-72 whitespace-normal break-words text-left"
              >
                {statusTitle}
              </TooltipContent>
            </Tooltip>
          ) : (
            statusIcon
          )}
        </span>
        <Button
          type="button"
          variant="outline"
          className="h-7 w-[68px] shrink-0 overflow-hidden px-1 text-xs"
          disabled={disabled || actionDisabled || value.trim() === ""}
          onClick={onAction}
          title={t("settings.claude.testModelTitle")}
        >
          <span className="truncate">
            {status === "testing" ? t("settings.testing") : actionLabel}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          disabled={disabled || removeDisabled}
          onClick={onRemove}
          aria-label={removeLabel ?? label}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {duplicate && (
        <p className="text-xs text-destructive">
          {t("settings.claude.duplicateModel")}
        </p>
      )}
    </div>
  );
}
