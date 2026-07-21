import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Locale = "en";

type MessageTree = Record<string, unknown>;

const messages: Record<Locale, MessageTree> = {
  en: {
    shell: {
      appName: "Nest",
      appSubtitle: "Knowledge workspace",
      hub: "Hub",
      settings: "Settings",
      chat: "Chat",
      collapseLibrary: "Collapse library",
      expandLibrary: "Expand library",
      collapseChat: "Collapse chat",
      expandChat: "Expand chat",
      loading: "Loading…",
      noFilesOpen: "No files open",
    },
    settings: {
      title: "Settings",
      description:
        "Changes save automatically. Connection problems show up when you chat or open the Hub.",
      personal: "Personal",
      personalDescription: "How Nest addresses you and where packs are stored.",
      yourName: "Your name",
      yourNameDescription: "Displayed in the UI where your name is referenced.",
      optional: "Optional",
      knowledgeDirectory: "Local knowledge directory",
      knowledgeDirectoryDescription:
        "Choose where local knowledge packs and indexes are stored.",
      usingDefaultVault: "Using the app default vault folder.",
      usingCustomVault: "Using a custom folder. Re-indexes automatically.",
      resetToDefault: "Reset to default",
      appearance: "Appearance",
      appearanceDescription: "Display preferences that only affect the app UI.",
      fontSize: "Font size",
      fontSizeDescription: "Controls the font size in pixels.",
      displayLanguage: "Display language",
      displayLanguageDescription: "Select the UI language used across the app.",
      english: "English",
      fontSizeWarningTitle: "Font size out of range",
      fontSizeWarningDescription:
        "Please re-enter a value between {{min}} and {{max}} pt.",
      appearanceRestartTitle: "Restart required",
      appearanceRestartDescription:
        "Appearance changes will take effect after you restart the app.",
      llm: "LLM",
      llmDescription: "OpenAI-compatible chat API used for answers and titles.",
      baseUrl: "Base URL",
      baseUrlDescription: "Endpoint for your OpenAI-compatible API service.",
      apiKey: "API key",
      apiKeyDescription: "Authentication key sent with requests to the LLM API.",
      chatModel: "Chat model",
      chatModelDescription: "Model ID used for chat responses and title generation.",
      knowledgeHub: "Knowledge Hub",
      knowledgeHubDescription: "Remote catalog for pack downloads.",
      hubBaseUrl: "Hub base URL",
      hubBaseUrlDescription: "Address of the pack registry service for browsing packs.",
      testConnection: "Test connection",
      testing: "Testing…",
      connected: "Knowledge Hub connected",
      connectionFailed: "Knowledge Hub connection failed",
      couldNotSave: "Could not save settings",
      couldNotOpenFolder: "Could not open folder picker",
      couldNotTestHub: "Could not test Knowledge Hub",
    },
    hub: {
      title: "Knowledge Hub",
      description:
        "Install versioned packs from the configured catalog, create one from a local folder, or import a shareable ZIP.",
      online: "Online",
      offline: "Offline",
      offlineToastTitle: "Knowledge Hub offline",
      offlineToastDescription:
        "Catalog unavailable. You can still create or import a local pack.",
      import: "Import",
      browse: "Browse",
      installed: "Installed",
      connectHub: "Connect to the Knowledge Hub",
      hubOfflineFootnote:
        "Packs already in your vault stay available in the Installed tab.",
      browseRegistry: "Browse the registry",
      browseRegistryBody:
        "Start the Hub service and check the Hub URL in Settings to browse and download packs.",
      havePackFile: "Have a pack file?",
      havePackFileBody:
        "No connection needed — create a pack from a local folder or import a shared ZIP.",
      searchPacks: "Search packs…",
      loadingPacks: "Loading packs…",
      noPacksMatch: "No packs match “{{query}}”.",
      registryEmpty: "The registry has no packs available yet",
      version: "Version",
      installedBadge: "Installed",
      updateAvailable: "Update available",
      installedLabel: "Installed {{version}}",
      install: "Install",
      upgrade: "Upgrade",
      installVersion: "Install {{version}}",
      downgradeWarningTitle: "Confirm downgrade",
      downgradeWarningDescription:
        "You are about to downgrade from {{currentVersion}} to {{targetVersion}}. Continue only if you want to replace the current installed version.",
      download: "Download",
      downloading: "Downloading…",
      upgrading: "Upgrading…",
      fromRegistry: "From registry",
      importedLocally: "Imported locally",
      inVault: "In vault",
      localFolder: "Local folder · {{path}}",
      exportZip: "Export ZIP",
      exportKnowledgePack: "Export knowledge pack",
      importOrCreateAnother: "Import or create another pack…",
      selectZipTitle: "Select a knowledge pack zip",
      selectFolderTitle: "Select knowledge folder",
      chooseImportModeTitle: "Import knowledge pack",
      createFromFolderTitle: "Create from folder",
      importPackZipTitle: "Import pack ZIP",
      dropZipToSelect: "Drop ZIP to select",
      dragPackZipHere: "Drag a pack ZIP here",
      orClickToBrowse: "or click to browse",
      importDialogBack: "Back",
      importDialogCancel: "Cancel",
      importDialogImportZip: "Import ZIP",
      importDialogCreatePack: "Create pack",
      packId: "Pack ID",
      name: "Name",
      descriptionOptional: "Description (optional)",
      packDownloaded: "Pack downloaded",
      packUpgraded: "Pack upgraded",
      packImported: "Pack imported",
      packCreated: "Knowledge pack created",
      packExported: "Knowledge pack exported",
      packRemoved: "Pack removed",
      uninstall: "Uninstall",
      uninstalling: "Uninstalling…",
      uninstallPack: "Uninstall",
      uninstallPackTitle: "Uninstall knowledge pack?",
      uninstallPackDescription:
        "This permanently deletes “{{name}}” from your local vault and cannot be undone. The remote pack remains available and can be downloaded again from the Hub.",
      cancel: "Cancel",
      downloadFailed: "Download failed",
      importFailed: "Import failed",
      createFailed: "Could not create pack",
      exportFailed: "Export failed",
      removeFailed: "Uninstall failed",
      searchPlaceholder: "Search packs…",
      installedCount: "Installed ({{count}})",
      indexedFiles: "{{count}} files indexed",
      downloadDescription: "{{packId}}@{{version}}: {{count}} files indexed",
      upgradeDescription:
        "{{packId}} {{previousVersion}} → {{version}} ({{count}} files indexed)",
      removedDescription: "{{packId}} deleted and search index refreshed",
    },
  },
};

function resolvePath(root: MessageTree, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (value && typeof value === "object" && segment in value) {
      return (value as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);
}

function format(template: string, params?: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = params?.[key];
    return value == null ? "" : String(value);
  });
}

export function isLocale(value: string): value is Locale {
  return value === "en";
}

type I18nValue = {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(() => {
    const t: I18nValue["t"] = (key, params) => {
      const fallback = resolvePath(messages.en, key) ?? key;
      const resolved = resolvePath(messages[locale], key) ?? fallback;
      return format(String(resolved), params);
    };
    return { locale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (value) return value;
  const fallback: I18nValue = {
    locale: "en",
    t: (key, params) => format(String(resolvePath(messages.en, key) ?? key), params),
  };
  return fallback;
}
