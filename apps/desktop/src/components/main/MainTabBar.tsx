import { Bell, Cloud, FileText, GitCompare, Image as ImageIcon, Settings2 } from "lucide-react";
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
import { buttonVariants } from "@/components/ui/button";
import { TabStrip } from "@/components/ui/tab-strip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isImagePath } from "@/lib/vault-paths";
import { useEditorStore } from "@/stores/editor";
import {
  HUB_TAB_ID,
  MESSAGES_TAB_ID,
  parseDiffTabId,
  SETTINGS_TAB_ID,
  useUiStore,
} from "@/stores/ui";

function tabLabel(id: string, t: ReturnType<typeof useI18n>["t"]) {
  if (id === HUB_TAB_ID) return t("shell.hub");
  if (id === SETTINGS_TAB_ID) return t("shell.settings");
  if (id === MESSAGES_TAB_ID) return "Messages";
  const diffTab = parseDiffTabId(id);
  if (diffTab) return `${diffTab.path.split("/").pop() || diffTab.path} (diff)`;
  return id.split("/").pop() || id;
}

function tabIcon(id: string) {
  if (id === HUB_TAB_ID)
    return <Cloud className="size-3 shrink-0 text-accent" />;
  if (id === SETTINGS_TAB_ID)
    return <Settings2 className="size-3 shrink-0 text-accent" />;
  if (id === MESSAGES_TAB_ID)
    return <Bell className="size-3 shrink-0 text-accent" />;
  if (parseDiffTabId(id))
    return <GitCompare className="size-3 shrink-0 text-accent" />;
  if (isImagePath(id))
    return <ImageIcon className="size-3 shrink-0 text-primary" />;
  return <FileText className="size-3 shrink-0 text-primary" />;
}

export function MainTabBar() {
  const { t } = useI18n();
  const openMainTabs = useUiStore((s) => s.openMainTabs);
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const previewMainTabId = useUiStore((s) => s.previewMainTabId);
  const setActiveMainTab = useUiStore((s) => s.setActiveMainTab);
  const closeMainTab = useUiStore((s) => s.closeMainTab);
  const openFileTab = useUiStore((s) => s.openFileTab);
  const dirtyPaths = useEditorStore((s) => s.dirtyPaths);
  const setDirty = useEditorStore((s) => s.setDirty);
  const setEditing = useEditorStore((s) => s.setEditing);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);

  const requestClose = (id: string) => {
    if (dirtyPaths.has(id)) {
      setPendingCloseId(id);
    } else {
      closeMainTab(id);
    }
  };

  return (
    <>
      <TabStrip
        items={openMainTabs.map((id) => ({
          id,
          label: tabLabel(id, t),
          title: id,
          icon: tabIcon(id),
          italic: id === previewMainTabId,
          dirty: dirtyPaths.has(id),
        }))}
        activeId={activeMainTabId}
        onSelect={setActiveMainTab}
        onClose={requestClose}
        onItemDoubleClick={(id) => {
          if (id === previewMainTabId) openFileTab(id, { preview: false });
        }}
        emptyLabel={t("shell.noFilesOpen")}
      />
      <AlertDialog
        open={pendingCloseId != null}
        onOpenChange={(open) => !open && setPendingCloseId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCloseId ? tabLabel(pendingCloseId, t) : ""} has unsaved
              edits. Closing this tab discards them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              onClick={() => {
                if (pendingCloseId) {
                  setDirty(pendingCloseId, false);
                  setEditing(pendingCloseId, false);
                  closeMainTab(pendingCloseId);
                }
                setPendingCloseId(null);
              }}
            >
              Discard and close
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
