import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { appErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export function RefreshButton({
  onRefresh,
  refreshing = false,
  label = "Refresh",
  size = "icon-sm",
  variant = "ghost",
  className,
}: {
  onRefresh: () => void | Promise<void>;
  refreshing?: boolean;
  label?: string;
  size?: "icon" | "icon-sm" | "icon-xs";
  variant?: "ghost" | "outline";
  className?: string;
}) {
  const [refreshPending, setRefreshPending] = useState(false);
  const active = refreshing || refreshPending;

  const handleRefresh = async () => {
    const startedAt = Date.now();
    setRefreshPending(true);
    try {
      await onRefresh();
      toast.success(`${label} complete`);
    } catch (error) {
      toast.error(`${label} failed`, {
        description: appErrorMessage(error),
      });
    } finally {
      const remaining = 500 - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      setRefreshPending(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          aria-label={label}
          aria-busy={active}
          disabled={active}
          className={className}
          onClick={() => void handleRefresh()}
        >
          <RefreshCw className={cn("size-4", active && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
