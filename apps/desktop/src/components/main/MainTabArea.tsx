import { useQuery } from "@tanstack/react-query";
import { BookOpen, Cloud, PackageOpen } from "lucide-react";
import { HubPanel } from "@/components/hub/HubPanel";
import { MainTabBar } from "@/components/main/MainTabBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkdownViewer } from "@/components/viewer/MarkdownViewer";
import { api } from "@/lib/api";
import { HUB_TAB_ID, SETTINGS_TAB_ID, useUiStore } from "@/stores/ui";

export function MainTabArea() {
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const openHubTab = useUiStore((s) => s.openHubTab);

  const treeQuery = useQuery({
    queryKey: ["tree"],
    queryFn: api.vaultListTree,
  });

  const vaultEmpty = !treeQuery.isLoading && (treeQuery.data?.length ?? 0) === 0;

  let content;
  if (activeMainTabId === HUB_TAB_ID) {
    content = <HubPanel />;
  } else if (activeMainTabId === SETTINGS_TAB_ID) {
    content = <SettingsPanel />;
  } else if (activeMainTabId) {
    content = <MarkdownViewer path={activeMainTabId} />;
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
