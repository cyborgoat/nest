import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function RenamePackDialog({
  open,
  onOpenChange,
  currentName,
  onRename,
  renaming = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (name: string) => void;
  renaming?: boolean;
}) {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const trimmed = name.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Rename pack</DialogTitle>
          <DialogDescription>
            Renames the pack's folder in your library to match — a pack's
            name and its folder are always the same. Only available for
            packs you created or imported locally.
          </DialogDescription>
        </DialogHeader>
        <Field label="Name">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && trimmed && !renaming) {
                e.preventDefault();
                onRename(trimmed);
              }
            }}
          />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={renaming}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={!trimmed || renaming} onClick={() => onRename(trimmed)}>
            {renaming && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
