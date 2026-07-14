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
        "relative flex w-px shrink-0 items-center justify-center bg-border transition-colors hover:bg-primary/40",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-card">
          <GripVertical className="size-2.5 text-muted-foreground" />
        </div>
      ) : null}
    </ResizablePrimitiveSeparator>
  );
}
