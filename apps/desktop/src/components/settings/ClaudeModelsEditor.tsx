import { Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { isDuplicateRow } from "./model-rows";

export function ClaudeModelsEditor({
  rows,
  disabled = false,
  onChange,
}: {
  rows: string[];
  disabled?: boolean;
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

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const duplicate = isDuplicateRow(rows, index);
        return (
          <div key={index} className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Input
                ref={index === rows.length - 1 ? lastRowRef : undefined}
                value={row}
                disabled={disabled}
                onChange={(e) => updateRow(index, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (row.trim() !== "" && index === rows.length - 1) {
                      addRow();
                    }
                  }
                }}
                aria-label={t("settings.claude.modelRowLabel", {
                  index: index + 1,
                })}
                placeholder="glm-5.3"
                className="font-mono text-xs"
              />
              {duplicate && (
                <p className="text-xs text-destructive">
                  {t("settings.claude.duplicateModel")}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              disabled={disabled}
              onClick={() => removeRow(index)}
              aria-label={t("settings.claude.removeModelRow", {
                index: index + 1,
              })}
            >
              <X className="size-3.5" />
            </Button>
          </div>
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
