import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { AdminPack as Pack } from "@nest/shared";
import { Button, Dialog, Field, Select } from "./ui";

export type PackEditPayload = {
  name: string;
  description: string;
  owner_id: string | null;
  visibility: Pack["visibility"];
};

export function EditPackDialog({
  pack,
  open,
  onOpenChange,
  busy,
  onSave,
}: {
  pack: Pack;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  onSave: (body: PackEditPayload) => void;
}) {
  const [name, setName] = useState(pack.name);
  const [description, setDescription] = useState(pack.description);
  const [owner, setOwner] = useState(pack.owner_id ?? "");
  const [visibility, setVisibility] = useState(pack.visibility);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit knowledge pack"
      description="Update catalog metadata and access posture. Archiving is managed from the pack's action menu."
    >
      <div className="grid gap-4">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <textarea
            className="input min-h-24 resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Owner account ID">
          <input
            className="input"
            value={owner}
            placeholder="Leave blank for no owner"
            onChange={(e) => setOwner(e.target.value)}
          />
        </Field>
        <Field label="Visibility">
          <Select
            value={visibility}
            onValueChange={(value) =>
              setVisibility(value as Pack["visibility"])
            }
            options={[
              { value: "public", label: "Public — visible to everyone" },
              {
                value: "restricted",
                label: "Restricted — selected users only",
              },
            ]}
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Cancel</Button>
        </DialogPrimitive.Close>
        <Button
          disabled={busy || !name.trim()}
          onClick={() =>
            onSave({
              name,
              description,
              owner_id: owner || null,
              visibility,
            })
          }
        >
          Save changes
        </Button>
      </div>
    </Dialog>
  );
}
