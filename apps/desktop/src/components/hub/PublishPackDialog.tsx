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

export type PublishPackIntent =
  | {
      kind: "release";
      version: string;
      description: string;
      commitMessage: string;
    }
  | { kind: "live_patch"; targetVersion: string; commitMessage: string };

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
  canLivePatch = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packName: string;
  currentVersion: string;
  currentDescription: string;
  /** True for a local pack that has never been published before. */
  isFirstPublish: boolean;
  onPublish: (intent: PublishPackIntent) => void;
  publishing?: boolean;
  /** Set when this pack already has an unresolved submission. Renders an
   *  explanation instead of the form — defense-in-depth in case the dialog
   *  is already open when a reconcile poll flips the lock on; the entry
   *  points that open this dialog already prevent it in the normal case. */
  lockedPendingVersion?: string | null;
  /** Wait for the latest Hub release metadata before exposing editable
   * defaults. Falls back to local metadata if that lookup fails. */
  defaultsLoading?: boolean;
  /** True when the installed pack is already linked to a Hub project even
   * if catalog metadata is temporarily stale or unavailable. */
  canLivePatch?: boolean;
}) {
  const [requestType, setRequestType] = useState<"release" | "live_patch">(
    "release",
  );
  const [version, setVersion] = useState(currentVersion);
  const [description, setDescription] = useState(currentDescription);
  const [commitMessage, setCommitMessage] = useState("");

  useLayoutEffect(() => {
    if (open) {
      setVersion(
        isFirstPublish ? currentVersion : nextPatchVersion(currentVersion),
      );
      setDescription(currentDescription);
      setCommitMessage("");
      setRequestType("release");
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
              : requestType === "live_patch"
                ? "Updates an existing release without changing its semantic version. Reviewers will see this as a live patch."
                : "Submits your edits as a new version for review. The hub keeps every version, so this can't reuse an already-published version number."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!isFirstPublish || canLivePatch ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={requestType === "release" ? "default" : "outline"}
                onClick={() => {
                  setRequestType("release");
                  setVersion(nextPatchVersion(currentVersion));
                }}
              >
                New release
              </Button>
              <Button
                type="button"
                variant={requestType === "live_patch" ? "default" : "outline"}
                disabled={!canLivePatch}
                onClick={() => setRequestType("live_patch")}
              >
                Live patch
              </Button>
            </div>
          ) : (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Live patch becomes available after this pack has an approved Hub
              release.
            </p>
          )}
          <Field label="Version">
            {requestType === "live_patch" ? (
              <Input value={currentVersion} disabled />
            ) : (
              <Input
                autoFocus
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0.0"
              />
            )}
          </Field>
          {requestType === "release" && (
            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this knowledge pack for?"
                rows={3}
              />
            </Field>
          )}
          {requestType === "live_patch" && (
            <p className="text-xs text-muted-foreground">
              Replaces the selected release’s files after the normal review
              process, without creating a new semantic version. Pack metadata
              cannot change.
            </p>
          )}
          <Field label="Publish commit message">
            <Textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Summarize what changed in this publish"
              rows={2}
              maxLength={500}
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
            disabled={
              publishing ||
              !commitMessage.trim() ||
              (requestType === "live_patch"
                ? !currentVersion.trim()
                : !version.trim())
            }
            onClick={() => {
              if (requestType === "live_patch") {
                onPublish({
                  kind: "live_patch",
                  targetVersion: currentVersion,
                  commitMessage: commitMessage.trim(),
                });
              } else {
                onPublish({
                  kind: "release",
                  version: version.trim(),
                  description: description.trim(),
                  commitMessage: commitMessage.trim(),
                });
              }
            }}
          >
            {publishing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CloudUpload className="size-4" />
            )}
            {requestType === "live_patch" ? "Submit live patch" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
