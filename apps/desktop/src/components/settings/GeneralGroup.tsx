import { Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function GeneralGroup({
  icon: Icon,
  title,
  help,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  help?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h4 className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="size-4 text-primary" aria-hidden />
          {title}
          {help && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`${title} configuration help`}
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                align="start"
                className="max-w-80 normal-case leading-5 tracking-normal"
              >
                {help}
              </TooltipContent>
            </Tooltip>
          )}
        </h4>
        {action}
      </div>
      {children}
    </div>
  );
}
