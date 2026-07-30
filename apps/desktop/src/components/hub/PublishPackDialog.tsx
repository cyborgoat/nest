import { CloudUpload, Loader2 } from "lucide-react";
import { useLayoutEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { nextPatchVersion } from "@/lib/semver";

export function PublishPackDialog({
  open,
  onOpenChange,
  packName,
  currentVersion,
  currentDescription,
  isFirstPublish,
  onPublish,
  publishing = false,
  lockedPendingVersion,
  defaultsLoading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packName: string;
  currentVersion: string;
  currentDescription: string;
  /** True for a local pack that has never been published before. */
  isFirstPublish: boolean;
  onPublish: (version: string, description: string) => void;
  publishing?: boolean;
  /** Set when this pack already has an unresolved submission. Renders an
   *  explanation instead of the form — defense-in-depth in case the dialog
   *  is already open when a reconcile poll flips the lock on; the entry
   *  points that open this dialog already prevent it in the normal case. */
  lockedPendingVersion?: string | null;
  /** Wait for the latest Hub release metadata before exposing editable
   * defaults. Falls back to local metadata if that lookup fails. */
  defaultsLoading?: boolean;
}) {
  const [version, setVersion] = useState(currentVersion);
  const [description, setDescription] = useState(currentDescription);

  useLayoutEffect(() => {
    if (open) {
      setVersion(isFirstPublish ? currentVersion : nextPatchVersion(currentVersion));
      setDescription(currentDescription);
    }
  }, [open, currentVersion, currentDescription, isFirstPublish]);

  if (lockedPendingVersion) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Publish {packName}</DialogTitle>
            <DialogDescription>
              {packName} already has v{lockedPendingVersion} awaiting review.
              You can submit again once it's approved or rejected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (defaultsLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Publish {packName}</DialogTitle>
            <DialogDescription>
              Loading the latest release details from Hub…
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Preparing publish details
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Publish {packName}</DialogTitle>
          <DialogDescription>
            {isFirstPublish
              ? "Submits this pack to the hub for review."
              : "Submits your edits as a new version for review. The hub keeps every version, so this can't reuse an already-published version number."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Version">
            <Input
              autoFocus
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0.0"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this knowledge pack for?"
              rows={3}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={publishing}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={!version.trim() || publishing}
            onClick={() => onPublish(version.trim(), description.trim())}
          >
            {publishing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CloudUpload className="size-4" />
            )}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
