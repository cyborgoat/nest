import { useQuery } from "@tanstack/react-query";
import { BookOpen, Cloud, PackageOpen } from "lucide-react";
import { HubPanel } from "@/components/hub/HubPanel";
import { MainTabBar } from "@/components/main/MainTabBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { MessagesPanel } from "@/components/messages/MessagesPanel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { DiffViewer } from "@/components/viewer/DiffViewer";
import { MarkdownEditor } from "@/components/viewer/MarkdownEditor";
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useEditorStore } from "@/stores/editor";
import {
  HUB_TAB_ID,
  MESSAGES_TAB_ID,
  parseDiffTabId,
  SETTINGS_TAB_ID,
  useUiStore,
} from "@/stores/ui";

export function MainTabArea() {
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const openHubTab = useUiStore((s) => s.openHubTab);
  const editingPaths = useEditorStore((s) => s.editingPaths);

  const treeQuery = useQuery({
    queryKey: queryKeys.tree,
    queryFn: api.vaultListTree,
  });

  const vaultEmpty =
    !treeQuery.isLoading && (treeQuery.data?.length ?? 0) === 0;

  const diffTab = activeMainTabId ? parseDiffTabId(activeMainTabId) : null;

  let content;
  if (activeMainTabId === HUB_TAB_ID) {
    content = <HubPanel />;
  } else if (activeMainTabId === SETTINGS_TAB_ID) {
    content = <SettingsPanel />;
  } else if (activeMainTabId === MESSAGES_TAB_ID) {
    content = <MessagesPanel />;
  } else if (diffTab) {
    content = (
      <DiffViewer
        key={activeMainTabId}
        packId={diffTab.packId}
        path={diffTab.path}
      />
    );
  } else if (activeMainTabId) {
    content = editingPaths.has(activeMainTabId) ? (
      <MarkdownEditor key={activeMainTabId} path={activeMainTabId} />
    ) : (
      <MarkdownViewer path={activeMainTabId} />
    );
  } else if (vaultEmpty) {
    content = (
      <EmptyState
        icon={<PackageOpen className="size-8 text-primary" />}
        title="Your library is empty"
        description="Download a knowledge pack from Hub to get started."
      >
        <Button onClick={openHubTab}>
          <Cloud className="size-4" />
          Open Hub
        </Button>
      </EmptyState>
    );
  } else {
    content = (
      <EmptyState
        icon={<BookOpen className="size-8 text-primary" />}
        title="Select a knowledge file"
        description="Browse the library tree. Knowledge files are read-only after download."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MainTabBar />
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}
