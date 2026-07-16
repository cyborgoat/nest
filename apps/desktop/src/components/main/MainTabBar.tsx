import { Cloud, FileText, Settings2 } from "lucide-react";
import { TabStrip } from "@/components/ui/tab-strip";
import { HUB_TAB_ID, SETTINGS_TAB_ID, useUiStore } from "@/stores/ui";

function tabLabel(id: string) {
  if (id === HUB_TAB_ID) return "Hub";
  if (id === SETTINGS_TAB_ID) return "Settings";
  return id.split("/").pop() || id;
}

function tabIcon(id: string) {
  if (id === HUB_TAB_ID) return <Cloud className="size-3 shrink-0 text-accent" />;
  if (id === SETTINGS_TAB_ID)
    return <Settings2 className="size-3 shrink-0 text-accent" />;
  return <FileText className="size-3 shrink-0 text-primary" />;
}

export function MainTabBar() {
  const openMainTabs = useUiStore((s) => s.openMainTabs);
  const activeMainTabId = useUiStore((s) => s.activeMainTabId);
  const previewMainTabId = useUiStore((s) => s.previewMainTabId);
  const setActiveMainTab = useUiStore((s) => s.setActiveMainTab);
  const closeMainTab = useUiStore((s) => s.closeMainTab);
  const openFileTab = useUiStore((s) => s.openFileTab);

  return (
    <TabStrip
      items={openMainTabs.map((id) => ({
        id,
        label: tabLabel(id),
        title: id,
        icon: tabIcon(id),
        italic: id === previewMainTabId,
      }))}
      activeId={activeMainTabId}
      onSelect={setActiveMainTab}
      onClose={closeMainTab}
      onItemDoubleClick={(id) => {
        if (id === previewMainTabId) openFileTab(id, { preview: false });
      }}
      emptyLabel="No files open"
    />
  );
}
