import { FileText, Folder } from "lucide-react";
import type { MentionRef } from "@/components/chat/MentionComposer";

export function renderWithMentions(
  content: string,
  mentions: Map<string, MentionRef>,
) {
  return content.split(/(@[^\s]+)/g).map((part, i) => {
    const ref = part.startsWith("@") ? mentions.get(part.slice(1)) : undefined;
    if (!ref) return part;
    return (
      <span
        key={i}
        className="mx-0.5 inline-flex max-w-[10rem] items-center gap-1 rounded-full bg-primary-foreground/15 px-1.5 py-0.5 align-middle text-[11px] font-medium"
        title={ref.path}
      >
        {ref.kind === "folder" ? (
          <Folder className="size-2.5 shrink-0" />
        ) : (
          <FileText className="size-2.5 shrink-0" />
        )}
        <span className="truncate">{ref.name}</span>
      </span>
    );
  });
}
