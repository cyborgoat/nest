import type { ReactNode } from "react";
import { SectionLabel } from "@/components/ui/section-label";

/** Compact header for sidebar panes (Explorer, Source Control). The main
 * tab area uses PanelHeader instead. */
export function SidebarPaneHeader({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
      <SectionLabel className="px-0">{title}</SectionLabel>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
