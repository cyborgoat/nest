import { CheckCircle2, Plus, X, XCircle } from "lucide-react";
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

export type ModelRowStatus = "idle" | "ok" | "fail";
export type ModelRowOutcome = { ok: boolean; message: string | null };
export type ModelRowStatuses = Record<string, ModelRowStatus | ModelRowOutcome>;

export function ClaudeModelsEditor({
  rows,
  disabled = false,
  defaultModel = "",
  rowStatuses,
  onChange,
}: {
  rows: string[];
  disabled?: boolean;
  defaultModel?: string;
  rowStatuses?: ModelRowStatuses;
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
    onChange(rows.filter((_, i) => i !== index));
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

  return (
    <div className="space-y-2">
      {defaultModel.trim() !== "" && (
        <ModelRow
          label={t("settings.claude.defaultModelLabel")}
          value={defaultModel}
          disabled
          status="ok"
        />
      )}
      {rows.map((row, index) => {
        const duplicate = isDuplicateRow(rows, index);
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
        variant="settings"
        size="settings"
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
  inputRef,
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
  inputRef?: React.Ref<HTMLInputElement>;
  onRemove?: () => void;
  onChange?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { t } = useI18n();
  const statusTitle =
    status === "ok"
      ? (statusMessage ?? t("settings.claude.modelAvailable"))
      : status === "fail"
        ? (statusMessage ?? t("settings.claude.modelUnavailable"))
        : undefined;
  const statusIcon =
    status === "ok" ? (
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
  const statusContent = statusTitle ? (
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
  );
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-2">
        <Input
          ref={inputRef}
          value={value}
          disabled={disabled}
          readOnly={!onChange}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={label}
          placeholder={placeholder}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        {onRemove ? (
          <>
            <span className="flex w-4 shrink-0 items-center justify-center">
              {statusContent}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              disabled={disabled}
              onClick={onRemove}
              aria-label={removeLabel ?? label}
            >
              <X className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            <span className="w-4 shrink-0" aria-hidden="true" />
            <span className="flex size-7 shrink-0 items-center justify-center">
              {statusContent}
            </span>
          </>
        )}
      </div>
      {duplicate && (
        <p className="text-xs text-destructive">
          {t("settings.claude.duplicateModel")}
        </p>
      )}
    </div>
  );
}
