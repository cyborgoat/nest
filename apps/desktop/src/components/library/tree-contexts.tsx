import type { FileChangeStatus } from "@nest/shared";
import { createContext, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { VaultDragEntry } from "@/lib/tree-drag-drop";

export const DropTargetContext = createContext<{
  externalDropTargetPath: string | null;
  internalDropTargetNodePath: string | null;
  draggingPaths: ReadonlySet<string>;
  selectedPaths: ReadonlySet<string>;
  selectEntry: (
    entry: VaultDragEntry,
    event: ReactMouseEvent<HTMLElement>,
  ) => boolean;
  beginPointerDrag: (
    entry: VaultDragEntry,
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  suppressTreeClick: () => boolean;
  pathExists: (path: string) => boolean;
}>({
  externalDropTargetPath: null,
  internalDropTargetNodePath: null,
  draggingPaths: new Set(),
  selectedPaths: new Set(),
  selectEntry: () => false,
  beginPointerDrag: () => {},
  suppressTreeClick: () => false,
  pathExists: () => false,
});

export const ExplorerFileStatusContext = createContext<
  ReadonlyMap<string, FileChangeStatus>
>(new Map());

export type NewEntryKind = "file" | "folder";

export const ExplorerActionsContext = createContext<{
  canCreateEntry: boolean;
  onCreatePack: () => void;
  onImportFolder: () => void;
  onImportZip: () => void;
  onCreateEntry: (kind: NewEntryKind, preferredDestination?: string) => void;
  onOpenVaultFolder: () => void;
}>({
  canCreateEntry: false,
  onCreatePack: () => {},
  onImportFolder: () => {},
  onImportZip: () => {},
  onCreateEntry: () => {},
  onOpenVaultFolder: () => {},
});
