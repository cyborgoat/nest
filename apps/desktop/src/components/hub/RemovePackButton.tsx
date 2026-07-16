import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function RemovePackButton({
  name,
  disabled,
  pending,
  onConfirm,
}: {
  name: string;
  disabled: boolean;
  pending: boolean;
  onConfirm: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <div className="absolute top-0 right-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground"
              aria-label={`Actions for ${name}`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={disabled}
              onSelect={() => {
                window.setTimeout(() => setDialogOpen(true), 0);
              }}
            >
              <Trash2 className="size-3.5" />
              Remove pack
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove knowledge pack?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes “{name}” from your local vault and cannot
            be undone. The remote pack remains available and can be downloaded
            again from the Hub.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Removing…" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
