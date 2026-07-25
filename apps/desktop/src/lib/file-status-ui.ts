import type { FileChangeStatus } from "@nest/shared";

export const STATUS_LETTER: Record<FileChangeStatus, string> = {
  modified: "M",
  new: "N",
  deleted: "D",
};

export const STATUS_BADGE_VARIANT: Record<
  FileChangeStatus,
  "modified" | "new" | "destructive"
> = {
  modified: "modified",
  new: "new",
  deleted: "destructive",
};

export const STATUS_TEXT_CLASSES: Record<FileChangeStatus, string> = {
  modified: "text-amber-700 dark:text-amber-400",
  new: "text-[#23663a] dark:text-emerald-400",
  deleted: "text-destructive line-through",
};
