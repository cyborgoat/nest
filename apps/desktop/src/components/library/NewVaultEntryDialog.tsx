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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultVaultDestination,
  type VaultDestination,
} from "@/lib/vault-destinations";

export function NewVaultEntryDialog({
  open,
  onOpenChange,
  kind,
  destinations,
  preferredDestination,
  creating,
  error,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "file" | "folder";
  destinations: VaultDestination[];
  preferredDestination?: string;
  creating: boolean;
  error?: string | null;
  onCreate: (destination: VaultDestination, name: string) => void;
}) {
  const [destinationPath, setDestinationPath] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      return;
    }
    setDestinationPath(
      defaultVaultDestination(destinations, preferredDestination),
    );
  }, [destinations, open, preferredDestination]);

  const destination = destinations.find(
    (candidate) => candidate.path === destinationPath,
  );
  const title = kind === "file" ? "New file" : "New folder";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] min-w-0 max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Choose an editable folder in your library, then name the new {kind}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Destination">
            <Select value={destinationPath} onValueChange={setDestinationPath}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a folder" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((candidate) => (
                  <SelectItem key={candidate.path} value={candidate.path}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === "file" ? "filename.md" : "folder name"}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  destination &&
                  name.trim() &&
                  !creating
                ) {
                  event.preventDefault();
                  onCreate(destination, name.trim());
                }
              }}
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
            disabled={!destination || !name.trim() || creating}
            onClick={() => {
              if (destination) onCreate(destination, name.trim());
            }}
          >
            {creating && <Loader2 className="size-4 animate-spin" />}
            Create {kind}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
