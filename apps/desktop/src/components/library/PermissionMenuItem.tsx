import type { ReactNode } from "react";
import { ContextMenuItem } from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** A ContextMenuItem that stays visible but disabled — with a hover tooltip
 * explaining why — instead of disappearing, so every row's menu has the same
 * shape regardless of the viewer's permissions. */
export function PermissionMenuItem({
  disabled,
  reason,
  className,
  onSelect,
  children,
}: {
  disabled: boolean;
  reason?: string;
  className?: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  const item = (
    <ContextMenuItem
      disabled={disabled}
      className={className}
      onSelect={onSelect}
    >
      {children}
    </ContextMenuItem>
  );
  if (!disabled || !reason) return item;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{item}</span>
      </TooltipTrigger>
      <TooltipContent side="right">{reason}</TooltipContent>
    </Tooltip>
  );
}
