import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shared "Discard unsaved changes?" confirmation shell. Callers that reach
 * this dialog do genuinely different things on confirm (e.g. reverting a
 * file's content vs. closing its tab) — only the title/layout/button wiring
 * is common, so this takes the description and confirm action as props
 * rather than baking in one behavior. */
export function DiscardChangesDialog({
  open,
  onOpenChange,
  description,
  cancelLabel = "Cancel",
  confirmLabel = "Discard changes",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  description: ReactNode;
  cancelLabel?: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
