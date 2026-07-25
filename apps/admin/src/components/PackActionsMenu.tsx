import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, Download, Eye, MoreHorizontal, Trash2 } from "lucide-react";
import type { AdminPack as Pack } from "@nest/shared";
import { useApi } from "../app/contexts";
import { adminQueryKeys } from "../lib/api";
import { Button } from "./ui";

export function PackActionsMenu({
  pack,
  hideViewDetails = false,
  onDeleteRequest,
  triggerLabel,
}: {
  pack: Pack;
  /** Omit "View details" when this menu already lives on that pack's detail page. */
  hideViewDetails?: boolean;
  /** Parent owns the delete-confirmation dialog's target state. Omit to hide
   *  the Delete item entirely — pack deletion is now version-wise, driven
   *  from the pack detail page's release list instead of this menu. */
  onDeleteRequest?: (pack: Pack) => void;
  triggerLabel?: string;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const archiveToggle = useMutation({
    mutationFn: () =>
      api(`/api/admin/packs/${pack.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: !pack.archived }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminQueryKeys.packs }),
  });

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={triggerLabel ?? `Actions for ${pack.name}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          className="z-50 min-w-40 rounded-lg border border-border bg-card p-1 shadow-xl"
        >
          {!hideViewDetails && (
            <DropdownMenuPrimitive.Item asChild>
              <Link
                to="/packs/$packId"
                params={{ packId: pack.id }}
                className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none hover:bg-muted focus:bg-muted"
              >
                <Eye className="size-4" /> View details
              </Link>
            </DropdownMenuPrimitive.Item>
          )}
          <DropdownMenuPrimitive.Item asChild>
            <a
              href={`/packs/${pack.id}/download`}
              download
              className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none hover:bg-muted focus:bg-muted"
            >
              <Download className="size-4" /> Download .zip
            </a>
          </DropdownMenuPrimitive.Item>
          <DropdownMenuPrimitive.Item
            disabled={archiveToggle.isPending}
            className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted"
            onSelect={() => archiveToggle.mutate()}
          >
            <Archive className="size-4" />
            {pack.archived ? "Restore" : "Archive"}
          </DropdownMenuPrimitive.Item>
          {onDeleteRequest && (
            <>
              <DropdownMenuPrimitive.Separator className="my-1 h-px bg-border" />
              <DropdownMenuPrimitive.Item
                className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive outline-none data-[highlighted]:bg-destructive/10"
                onSelect={() => onDeleteRequest(pack)}
              >
                <Trash2 className="size-4" /> Delete permanently
              </DropdownMenuPrimitive.Item>
            </>
          )}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
