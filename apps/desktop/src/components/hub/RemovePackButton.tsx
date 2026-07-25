import { Download, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function RemovePackButton({
  name,
  disabled,
  pending,
  onExport,
  exportLabel,
  onConfirm,
  onPublish,
  publishLabel,
  publishDisabled,
  onRename,
}: {
  name: string;
  disabled: boolean;
  pending: boolean;
  onExport?: () => void;
  exportLabel?: string;
  onConfirm: () => void;
  onPublish?: () => void;
  publishLabel?: string;
  /** Disables only the Publish item — Export/Rename/Remove stay usable, e.g.
   *  while a previous submission for this pack is still under review. */
  publishDisabled?: boolean;
  onRename?: () => void;
}) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <div className="absolute top-0 right-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-xs"
              variant="ghost"
              className="pointer-events-none text-muted-foreground opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
              aria-label={`Actions for ${name}`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            {onPublish && (
              <>
                <DropdownMenuItem
                  disabled={disabled || publishDisabled}
                  onSelect={() => void onPublish()}
                >
                  <Send className="size-3.5" />
                  {publishLabel ?? "Publish"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {onRename && (
              <DropdownMenuItem disabled={disabled} onSelect={() => onRename()}>
                <Pencil className="size-3.5" />
                Rename
              </DropdownMenuItem>
            )}
            {onExport && (
              <DropdownMenuItem
                disabled={disabled}
                onSelect={() => void onExport()}
              >
                <Download className="size-3.5" />
                {exportLabel ?? "Export ZIP"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={disabled}
              onSelect={() => {
                window.setTimeout(() => setDialogOpen(true), 0);
              }}
            >
              <Trash2 className="size-3.5" />
              {t("hub.uninstallPack")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("hub.uninstallPackTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("hub.uninstallPackDescription", { name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("hub.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {pending ? t("hub.uninstalling") : t("hub.uninstall")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
