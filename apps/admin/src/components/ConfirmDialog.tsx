import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button, Dialog } from "./ui";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  busyLabel,
  tone = "danger",
  icon,
  busy = false,
  disabled = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: "danger" | "primary";
  icon?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      {children}
      <div className="mt-5 flex justify-end gap-2">
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Cancel</Button>
        </DialogPrimitive.Close>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          disabled={busy || disabled}
          onClick={onConfirm}
        >
          {icon}
          {busy ? busyLabel ?? confirmLabel : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
