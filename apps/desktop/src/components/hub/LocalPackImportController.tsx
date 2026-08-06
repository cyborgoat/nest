import type {
  InstalledPack,
  KnowledgePackMeta,
  LocalPackInspection,
} from "@nest/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ImportPackDialog } from "@/components/hub/ImportPackDialog";
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
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { packMutationInvalidations } from "@/lib/query-keys";

export type LocalPackImportMode = "choose" | "folder" | "zip";

type PendingOverwrite = {
  kind: "zip" | "zip-create" | "folder";
  sourcePath: string;
  metadata: KnowledgePackMeta;
  installed: InstalledPack;
};

export function LocalPackImportController({
  mode,
  onModeChange,
  installed,
}: {
  mode: LocalPackImportMode | null;
  onModeChange: (mode: LocalPackImportMode | null) => void;
  installed: InstalledPack[];
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [pendingOverwrite, setPendingOverwrite] =
    useState<PendingOverwrite | null>(null);

  const installedById = useMemo(
    () => new Map(installed.map((pack) => [pack.pack_id, pack])),
    [installed],
  );

  const invalidateAfterPackChange = () => {
    for (const queryKey of packMutationInvalidations) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const finishImport = (message: string) => {
    setPendingOverwrite(null);
    onModeChange(null);
    invalidateAfterPackChange();
    toast.success(message);
  };

  const importLocal = useMutation({
    mutationFn: ({
      sourcePath,
      overwrite,
    }: {
      sourcePath: string;
      overwrite: boolean;
    }) => api.hubImportLocalPack(sourcePath, overwrite),
    onSuccess: () => finishImport(t("hub.packImported")),
    onError: (error: Error) =>
      toast.error(t("hub.importFailed"), {
        description: error.message || String(error),
      }),
  });

  const createFromFolder = useMutation({
    mutationFn: ({
      sourcePath,
      metadata,
      overwrite,
    }: {
      sourcePath: string;
      metadata: KnowledgePackMeta;
      overwrite: boolean;
    }) => api.hubCreatePackFromFolder(sourcePath, metadata, overwrite),
    onSuccess: () => finishImport(t("hub.packCreated")),
    onError: (error: Error) =>
      toast.error(t("hub.createFailed"), {
        description: error.message || String(error),
      }),
  });

  const createFromZip = useMutation({
    mutationFn: ({
      sourcePath,
      metadata,
      overwrite,
    }: {
      sourcePath: string;
      metadata: KnowledgePackMeta;
      overwrite: boolean;
    }) => api.hubCreatePackFromZip(sourcePath, metadata, overwrite),
    onSuccess: () => finishImport(t("hub.packCreated")),
    onError: (error: Error) =>
      toast.error(t("hub.createFailed"), {
        description: error.message || String(error),
      }),
  });

  const importing =
    importLocal.isPending ||
    createFromFolder.isPending ||
    createFromZip.isPending;

  return (
    <>
      <ImportPackDialog
        open={mode != null}
        initialMode={mode ?? "choose"}
        onOpenChange={(open) => {
          if (!open && !importing) onModeChange(null);
        }}
        importing={importing}
        onImportZip={(sourcePath: string, inspection: LocalPackInspection) => {
          const existing = installedById.get(inspection.metadata.id.trim());
          const kind = inspection.needs_metadata ? "zip-create" : "zip";
          if (existing) {
            setPendingOverwrite({
              kind,
              sourcePath,
              metadata: inspection.metadata,
              installed: existing,
            });
          } else if (inspection.needs_metadata) {
            createFromZip.mutate({
              sourcePath,
              metadata: inspection.metadata,
              overwrite: false,
            });
          } else {
            importLocal.mutate({ sourcePath, overwrite: false });
          }
        }}
        onCreateFromFolder={(sourcePath, metadata) => {
          const existing = installedById.get(metadata.id.trim());
          if (existing) {
            setPendingOverwrite({
              kind: "folder",
              sourcePath,
              metadata,
              installed: existing,
            });
          } else {
            createFromFolder.mutate({
              sourcePath,
              metadata,
              overwrite: false,
            });
          }
        }}
      />
      <AlertDialog
        open={pendingOverwrite != null}
        onOpenChange={(open) => !open && setPendingOverwrite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace installed knowledge pack?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOverwrite
                ? `“${pendingOverwrite.installed.name}” ${pendingOverwrite.installed.version} is already installed. Importing “${pendingOverwrite.metadata.name}” ${pendingOverwrite.metadata.version} will replace it because Nest keeps one installed version per pack.`
                : "The installed knowledge pack will be replaced."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!pendingOverwrite || importing}
              onClick={(event) => {
                event.preventDefault();
                if (!pendingOverwrite) return;
                if (pendingOverwrite.kind === "zip") {
                  importLocal.mutate({
                    sourcePath: pendingOverwrite.sourcePath,
                    overwrite: true,
                  });
                } else if (pendingOverwrite.kind === "zip-create") {
                  createFromZip.mutate({
                    sourcePath: pendingOverwrite.sourcePath,
                    metadata: pendingOverwrite.metadata,
                    overwrite: true,
                  });
                } else {
                  createFromFolder.mutate({
                    sourcePath: pendingOverwrite.sourcePath,
                    metadata: pendingOverwrite.metadata,
                    overwrite: true,
                  });
                }
              }}
            >
              {importing ? "Replacing…" : "Replace pack"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
