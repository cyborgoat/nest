import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size={size}
          variant={variant}
          aria-label={label}
          disabled={refreshing}
          className={className}
          onClick={() => void onRefresh()}
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
