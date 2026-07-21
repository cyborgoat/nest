import { createContext, useContext, useMemo, type ReactNode } from "react";

export type Locale = "en" | "zh";

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
      chinese: "中文",
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
  zh: {
    shell: {
      appName: "Nest",
      appSubtitle: "知识工作区",
      hub: "Hub",
      settings: "Settings",
      chat: "Chat",
      collapseLibrary: "折叠资料库",
      expandLibrary: "展开资料库",
      collapseChat: "折叠聊天",
      expandChat: "展开聊天",
      loading: "加载中…",
      noFilesOpen: "没有打开文件",
    },
    settings: {
      title: "设置",
      description: "更改会自动保存. 连接问题会在聊天或打开资源库时显示.",
      personal: "个人",
      personalDescription: "Nest 如何称呼你, 以及知识包存放位置.",
      yourName: "你的名字",
      yourNameDescription: "用于界面中显示和引用你的名称.",
      optional: "可选",
      knowledgeDirectory: "本地知识目录",
      knowledgeDirectoryDescription: "选择本地知识包和索引的存储位置.",
      usingDefaultVault: "使用应用默认的资料库文件夹.",
      usingCustomVault: "使用自定义文件夹. 会自动重新索引.",
      resetToDefault: "恢复默认",
      appearance: "外观",
      appearanceDescription: "只影响应用界面的显示偏好.",
      fontSize: "字体大小",
      fontSizeDescription: "控制以像素为单位的字体大小.",
      displayLanguage: "显示语言",
      displayLanguageDescription: "选择应用界面使用的语言.",
      english: "English",
      chinese: "中文",
      fontSizeWarningTitle: "字体大小超出范围",
      fontSizeWarningDescription: "请重新输入 {{min}} 到 {{max}} pt 之间的值.",
      appearanceRestartTitle: "需要重启",
      appearanceRestartDescription: "外观更改将在重新启动应用后生效.",
      llm: "LLM",
      llmDescription: "用于回答和标题的 OpenAI 兼容聊天 API.",
      baseUrl: "基础地址",
      baseUrlDescription: "你的 OpenAI 兼容 API 服务地址.",
      apiKey: "API 密钥",
      apiKeyDescription: "向 LLM API 请求时使用的身份验证密钥.",
      chatModel: "聊天模型",
      chatModelDescription: "用于聊天回复和标题生成的模型 ID.",
      knowledgeHub: "知识资源库",
      knowledgeHubDescription: "用于下载知识包的远程目录.",
      hubBaseUrl: "资源库基础地址",
      hubBaseUrlDescription: "用于浏览知识包的资源库服务地址.",
      testConnection: "测试连接",
      testing: "测试中…",
      connected: "知识资源库已连接",
      connectionFailed: "知识资源库连接失败",
      couldNotSave: "无法保存设置",
      couldNotOpenFolder: "无法打开文件夹选择器",
      couldNotTestHub: "无法测试知识资源库",
    },
    hub: {
      title: "知识资源库",
      description: "从已配置目录安装版本化知识包, 创建本地文件夹知识包, 或导入可分享的 ZIP.",
      online: "在线",
      offline: "离线",
      offlineToastTitle: "知识资源库离线",
      offlineToastDescription: "目录不可用, 但你仍可创建或导入本地知识包.",
      import: "导入",
      browse: "浏览",
      installed: "已安装",
      connectHub: "连接到知识资源库",
      hubOfflineFootnote: "已在资料库中的知识包仍可在\"已安装\"标签中使用.",
      browseRegistry: "浏览目录",
      browseRegistryBody: "启动 Hub 服务, 并在设置中检查 Hub 地址以浏览和下载知识包.",
      havePackFile: "有知识包文件?",
      havePackFileBody: "不需要连接即可从本地文件夹创建知识包, 或导入共享 ZIP.",
      searchPacks: "搜索知识包…",
      loadingPacks: "加载知识包…",
      noPacksMatch: "没有匹配 \"{{query}}\" 的知识包.",
      registryEmpty: "当前目录还没有可用的知识包",
      version: "版本",
      installedBadge: "已安装",
      updateAvailable: "可更新",
      installedLabel: "已安装 {{version}}",
      install: "安装",
      upgrade: "升级",
      installVersion: "安装 {{version}}",
      downgradeWarningTitle: "确认降级",
      downgradeWarningDescription:
        "你将从 {{currentVersion}} 降级到 {{targetVersion}}. 仅当你确定要替换当前已安装版本时再继续.",
      download: "下载",
      fromRegistry: "来自目录",
      importedLocally: "本地导入",
      inVault: "资料库中",
      localFolder: "本地文件夹 · {{path}}",
      exportZip: "导出 ZIP",
      exportKnowledgePack: "导出知识包",
      importOrCreateAnother: "导入或创建另一个知识包…",
      selectZipTitle: "选择知识包 ZIP",
      selectFolderTitle: "选择知识文件夹",
      chooseImportModeTitle: "导入知识包",
      createFromFolderTitle: "从文件夹创建",
      importPackZipTitle: "导入知识包 ZIP",
      dropZipToSelect: "拖放 ZIP 以选择",
      dragPackZipHere: "将知识包 ZIP 拖到这里",
      orClickToBrowse: "或点击浏览",
      importDialogBack: "返回",
      importDialogCancel: "取消",
      importDialogImportZip: "导入 ZIP",
      importDialogCreatePack: "创建知识包",
      packId: "知识包 ID",
      name: "名称",
      descriptionOptional: "描述 (可选)",
      packDownloaded: "知识包已下载",
      packUpgraded: "知识包已升级",
      packImported: "知识包已导入",
      packCreated: "知识包已创建",
      packExported: "知识包已导出",
      packRemoved: "知识包已移除",
      uninstall: "卸载",
      uninstalling: "卸载中…",
      uninstallPack: "卸载",
      uninstallPackTitle: "卸载知识包?",
      uninstallPackDescription:
        "这会从你的本地资料库中永久删除 \"{{name}}\", 且无法撤销. 远程知识包仍然可用, 并且可以再次从资源库下载.",
      cancel: "取消",
      downloadFailed: "下载失败",
      importFailed: "导入失败",
      createFailed: "无法创建知识包",
      exportFailed: "导出失败",
      removeFailed: "卸载失败",
      searchPlaceholder: "搜索知识包…",
      installedCount: "已安装({{count}})",
      indexedFiles: "已索引 {{count}} 个文件",
      downloadDescription: "{{packId}}@{{version}}: 已索引 {{count}} 个文件",
      upgradeDescription:
        "{{packId}} {{previousVersion}} → {{version}} (已索引 {{count}} 个文件)",
      removedDescription: "{{packId}} 已删除并刷新搜索索引",
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
  return value === "en" || value === "zh";
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
