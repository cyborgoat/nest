import type { KnowledgePackMeta } from "@nest/shared";
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
import { EMPTY_PACK_META } from "@/lib/empty-pack-meta";

export function NewPackDialog({
  open,
  onOpenChange,
  onCreate,
  creating = false,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (metadata: KnowledgePackMeta) => void;
  creating?: boolean;
  error?: string | null;
}) {
  const [metadata, setMetadata] = useState<KnowledgePackMeta>(EMPTY_PACK_META);

  useEffect(() => {
    if (!open) setMetadata(EMPTY_PACK_META);
  }, [open]);

  const update = <K extends keyof KnowledgePackMeta>(
    key: K,
    value: KnowledgePackMeta[K],
  ) => setMetadata((current) => ({ ...current, [key]: value }));

  const valid = metadata.name.trim() && metadata.version.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] min-w-0 max-w-[520px]">
        <DialogHeader>
          <DialogTitle>New knowledge pack</DialogTitle>
          <DialogDescription>
            Creates an empty pack in your library, ready to edit. Nest derives
            a registry-safe ID and folder from its name.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <Field label="Name">
            <Input
              autoFocus
              value={metadata.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="My Knowledge Pack"
            />
          </Field>
          <Field label="Version">
            <Input
              value={metadata.version}
              onChange={(e) => update("version", e.target.value)}
              placeholder="0.1.0"
            />
          </Field>
          <Field label="Description (optional)">
            <Input
              value={metadata.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </Field>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={creating}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={!valid || creating}
            onClick={() => onCreate({ ...metadata, id: metadata.name })}
          >
            {creating && <Loader2 className="size-4 animate-spin" />}
            Create pack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
