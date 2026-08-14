import { GripVertical } from "lucide-react";
import {
  Group as ResizablePrimitiveGroup,
  Panel as ResizablePrimitivePanel,
  Separator as ResizablePrimitiveSeparator,
  type GroupProps,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels";
import { cn } from "@/lib/utils";

export function ResizablePanelGroup({
  className,
  orientation = "horizontal",
  ...props
}: GroupProps) {
  return (
    <ResizablePrimitiveGroup
      orientation={orientation}
      className={cn(
        "flex h-full w-full data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

export function ResizablePanel({ className, ...props }: PanelProps) {
  return (
    <ResizablePrimitivePanel
      className={cn("min-h-0 min-w-0", className)}
      {...props}
    />
  );
}

export function ResizableHandle({
  withHandle,
  className,
  ...props
}: SeparatorProps & { withHandle?: boolean }) {
  return (
    <ResizablePrimitiveSeparator
      className={cn(
        "relative flex w-1.5 shrink-0 items-center justify-center bg-transparent",
        "after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-[0.5px] after:-translate-x-1/2 after:bg-border/50 after:transition-colors",
        "hover:after:bg-primary/35",
        "aria-[orientation=horizontal]:h-1.5 aria-[orientation=horizontal]:w-full",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:inset-y-auto aria-[orientation=horizontal]:after:top-1/2 aria-[orientation=horizontal]:after:left-auto aria-[orientation=horizontal]:after:h-[0.5px] aria-[orientation=horizontal]:after:w-auto aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:translate-x-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border/50 bg-card">
          <GripVertical className="size-2.5 text-muted-foreground" />
        </div>
      ) : null}
    </ResizablePrimitiveSeparator>
  );
}
