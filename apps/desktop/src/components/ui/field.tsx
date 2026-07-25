import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Label + control stack used by every small metadata form (pack dialogs, import). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
