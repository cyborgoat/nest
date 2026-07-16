import { useQuery } from "@tanstack/react-query";
import { BookOpen, Cloud, PackageOpen } from "lucide-react";
import { motion } from "motion/react";
import { HubPanel } from "@/components/hub/HubPanel";
import { MainTabBar } from "@/components/main/MainTabBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { Button } from "@/components/ui/button";
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
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-full bg-muted p-4"
        >
          <PackageOpen className="size-8 text-primary" />
        </motion.div>
        <div>
          <h2 className="font-display text-xl">Your library is empty</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Download a knowledge pack from the Hub to get started.
          </p>
        </div>
        <Button onClick={openHubTab}>
          <Cloud className="size-4" />
          Open Hub
        </Button>
      </div>
    );
  } else {
    content = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-full bg-muted p-4"
        >
          <BookOpen className="size-8 text-primary" />
        </motion.div>
        <div>
          <h2 className="font-display text-xl">Select a knowledge file</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Browse the library tree. Knowledge files are read-only after download.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MainTabBar />
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
}
