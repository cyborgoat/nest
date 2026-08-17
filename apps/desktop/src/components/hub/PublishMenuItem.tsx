import { ArrowUp } from "lucide-react";
import type { InstalledPack } from "@nest/shared";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  isPublishMenuDisabled,
  publishMenuLabel,
} from "@/lib/publish-request-labels";

type PublishMenuItemProps = {
  pack: Pick<InstalledPack, "pending_version">;
  authenticated: boolean;
  onSelect: () => void;
  variant?: "context" | "dropdown";
};

export function PublishMenuItem({
  pack,
  authenticated,
  onSelect,
  variant = "context",
}: PublishMenuItemProps) {
  const Item = variant === "dropdown" ? DropdownMenuItem : ContextMenuItem;
  return (
    <Item
      disabled={isPublishMenuDisabled(pack)}
      onSelect={onSelect}
    >
      <ArrowUp className="size-3.5" />
      {publishMenuLabel(authenticated)}
    </Item>
  );
}
