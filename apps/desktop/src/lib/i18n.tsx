import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Only ~10 of 116 frontend files route their strings through `t()` — most
 * hardcode English directly, including inconsistently within some of the
 * 10 files that do use `t()`. This is a known, deliberate state, not an
 * oversight: `Locale` has exactly one variant today, so there is no
 * user-visible i18n bug, and mechanically converting the rest of the app's
 * strings now (100+ files, thousands of literals) would be a large,
 * error-prone change for zero current benefit. Treat this file as the
 * pattern to extend *if* a second locale is ever actually added — at that
 * point, finish the conversion file-by-file as those areas are touched,
 * rather than a single big-bang pass.
 */
export type Locale = "en";

type MessageTree = Record<string, unknown>;

const messages: Record<Locale, MessageTree> = {
  en: {
    shell: {
      appName: "Nest",
      appSubtitle: "Knowledge workspace",
      hub: "Hub",
      account: "Account",
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
        "Changes save automatically. Connection problems show up when you chat or open Hub.",
      personal: "Personal",
      personalDescription: "How Nest addresses you and where packs are stored.",
      yourName: "Your name",
      yourNameDescription: "Displayed in the UI where your name is referenced.",
      optional: "Optional",
      knowledgeDirectory: "Local vault directory",
      knowledgeDirectoryDescription:
        "Choose where local knowledge packs and indexes are stored.",
      usingDefaultVault: "Using the app default vault folder.",
      usingCustomVault: "Using a custom folder. Re-indexes automatically.",
      resetToDefault: "Reset to default",
      localIndex: "Local index",
      localIndexDescription:
        "Hybrid keyword + embedding search over your vault. Rebuilds automatically after changes; sync manually if retrieval seems out of date.",
      indexFiles: "files",
      indexChunks: "chunks",
      syncIndexNow: "Sync index",
      syncing: "Syncing…",
      syncFailed: "Could not sync index",
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
      apiKeyDescription:
        "Authentication key sent with requests to the LLM API.",
      chatModel: "Chat model",
      chatModelDescription:
        "Model ID used for chat responses and title generation.",
      knowledgeHub: "Hub",
      knowledgeHubDescription: "Remote catalog for pack downloads.",
      hubBaseUrl: "Hub URL",
      hubBaseUrlDescription: "Address of the Hub service for browsing packs.",
      network: "Network",
      networkDescription:
        "Optional proxy for Hub requests. When disabled, Nest connects directly and ignores system proxy.",
      proxyEnabled: "Use proxy",
      proxyEnabledDescription:
        "Route Hub and related requests through the URL below.",
      proxyUrl: "Proxy URL",
      proxyUrlDescription:
        "HTTP(S) or SOCKS5 proxy, for example http://127.0.0.1:7890.",
      testConnection: "Test connection",
      testing: "Testing…",
      connected: "Hub connected",
      connectionFailed: "Hub connection failed",
      couldNotSave: "Could not save settings",
      couldNotOpenFolder: "Could not open folder picker",
      couldNotTestHub: "Could not test Hub",
      claude: {
        group: "Claude Agent",
        groupDescription:
          "Route chat through your local Claude CLI. Knowledge tools, citations, and reviewable proposals work in both Ask and Agent modes.",
        enabled: "Enable Claude Agent",
        enabledDescription:
          "When enabled and connected, new chats bind to Claude on their first message. Existing chats keep their backend.",
        cliPath: "CLI path",
        cliPathDescription:
          "Leave empty to auto-detect. Accepts claude.exe, the npm cli-wrapper.cjs, or a claude shim.",
        autoDetect: "Auto-detect",
        detecting: "Detecting…",
        testConnection: "Test connection",
        testConnectionDescription:
          "Runs a real CLI round trip. Saving applies the current draft.",
        saveAndConnect: "Save and connect",
        save: "Save",
        saving: "Saving…",
        notSaved: "Tested, not saved",
        unsavedChanges: "Unsaved changes",
        unsavedChangesDescription:
          "Apply your changes with Save for them to take effect in chat.",
        stale: "Settings changed since the last test",
        statusConnected: "Connected",
        statusDisabled: "Claude Agent disabled",
        statusLastConnected: "Last connected",
        statusDisconnected: "Not connected",
        resolvedPath: "Resolved CLI",
        cliVersion: "CLI version",
        effectiveModel: "Effective model",
        testedAt: "Tested at",
        customModels: "Custom models",
        customModelsDescription:
          "One model ID per row. Used by the model selector in chat.",
        customStartupArgs: "Custom startup arguments",
        customStartupArgsDescription:
          "Optional arguments passed to every CLI launch. Quotes group values; no shell expansion is performed.",
        customModelsHint:
          "Optional — the default model appears here automatically after a connection test",
        addModel: "Add model",
        modelRowLabel: "Model {{index}}",
        removeModelRow: "Remove model {{index}}",
        duplicateModel: "Duplicate",
        detectionSucceeded: "Claude CLI {{version}} · {{strategy}}",
        detectionFailed: "No Claude CLI found on PATH or npm locations",
        detectionFailedPlaceholder: "Auto-detect Not Found",
        defaultModelLabel: "Default model",
        defaultModelAction: "default",
        testModel: "Test",
        testModelTitle: "Run a one-turn connectivity test with this model",
        testingModel: "Testing model",
        modelAvailable: "Model available",
        modelUnavailable: "Model unavailable",
        modelTestedAt: "Connection test passed at {{time}}",
        couldNotDetect: "Could not detect Claude CLI",
        couldNotTest: "Could not test Claude connection",
        couldNotSave: "Could not save Claude settings",
      },
    },
    account: {
      title: "Account",
      description:
        "Sign in to publish packs, access restricted knowledge, and manage your Hub profile.",
    },
    hub: {
      title: "Hub",
      description: "Browse and manage shared knowledge packs.",
      online: "Online",
      offline: "Offline",
      configureHub: "Configure Hub",
      connectHubBrowseTitle: "Connect a Hub to browse packs",
      connectHubBrowseDescription:
        "Add your team's Hub URL to browse and download shared packs.",
      hubUnavailableTitle: "Hub is unavailable",
      retryConnection: "Retry connection",
      openHubSettings: "Open Hub settings",
      localImportAvailable:
        "Local import remains available from the header. Packs already in your vault stay available in Installed.",
      accountOptionalTitle: "Account sign-in is optional",
      accountOptionalDescription:
        "Sign in only to publish packs or access restricted knowledge packs.",
      signInOrRegister: "Sign in or register",
      import: "Import",
      browse: "Browse",
      installed: "Installed",
      connectHub: "Connect to Hub",
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
      bundledPack: "Bundled",
      unknownOrigin: "Origin unknown",
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
      inspectingZip: "Inspecting ZIP…",
      zipMissingManifest:
        "This ZIP has no pack.json. Review the pack details below; Nest will create it during import.",
      importDialogBack: "Back",
      importDialogCancel: "Cancel",
      importDialogImportZip: "Import ZIP",
      importDialogCreatePack: "Create pack",
      packId: "Pack ID",
      name: "Name",
      descriptionOptional: "Description (optional)",
      packDownloaded: "Knowledge pack downloaded",
      packUpgraded: "Knowledge pack updated",
      packImported: "Knowledge pack imported",
      packCreated: "Knowledge pack created",
      packExported: "Knowledge pack exported",
      packRemoved: "Knowledge pack deleted",
      uninstall: "Uninstall",
      uninstalling: "Uninstalling…",
      uninstallPack: "Uninstall",
      uninstallPackTitle: "Uninstall knowledge pack?",
      uninstallPackDescription:
        "This permanently deletes “{{name}}” from your local vault and cannot be undone. The remote pack remains available and can be downloaded again from Hub.",
      cancel: "Cancel",
      downloadFailed: "Download failed",
      importFailed: "Import failed",
      createFailed: "Could not create pack",
      exportFailed: "Export failed",
      removeFailed: "Uninstall failed",
      searchPlaceholder: "Search packs…",
      installedCount: "Installed ({{count}})",
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
    t: (key, params) =>
      format(String(resolvePath(messages.en, key) ?? key), params),
  };
  return fallback;
}
