import { useQuery } from "@tanstack/react-query";
import { FileDiff, Lock, Pencil } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { parseFrontmatter } from "@/lib/frontmatter";
import {
  activeHeadingFromPositions,
  extractMarkdownHeadings,
  tocHeadings,
} from "@/lib/markdown-headings";
import { canEditPack, packEditBlockReason } from "@/lib/pack-permissions";
import { queryKeys } from "@/lib/query-keys";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { MarkdownFrontmatter } from "@/components/markdown/MarkdownFrontmatter";
import {
  MarkdownTableOfContents,
  MarkdownTableOfContentsMenu,
} from "@/components/markdown/MarkdownTableOfContents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MarkdownPathBreadcrumb } from "@/components/viewer/MarkdownPathBreadcrumb";
import { useEditorStore } from "@/stores/editor";

export function MarkdownViewer({ path }: { path: string }) {
  const pendingChangeQuery = useQuery({
    queryKey: queryKeys.pendingChatFileChange(path),
    queryFn: () => api.chatGetPendingFileChange(path),
  });
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.file(path),
    queryFn: () => api.vaultReadFile(path),
  });
  const setEditing = useEditorStore((s) => s.setEditing);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  const segments = path.split("/").filter(Boolean);
  const basePath = segments.slice(0, -1).join("/");
  const rootPath = segments[0] ?? "";

  const { data: installed } = useQuery({
    queryKey: queryKeys.installedPacks,
    queryFn: api.hubListInstalled,
  });
  const { data: hubAuth } = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const pack = installed?.find((p) => p.local_path === rootPath);
  const canEdit = pack ? canEditPack(pack, hubAuth?.user ?? null) : false;
  const readOnlyReason = pack
    ? packEditBlockReason(pack, hubAuth?.user ?? null)
    : "This file is read-only.";

  const { frontmatter, body } = useMemo(() => {
    if (data == null) return { frontmatter: null, body: data };
    const parsed = parseFrontmatter(data);
    return { frontmatter: parsed.data, body: parsed.content };
  }, [data]);

  const allHeadings = useMemo(
    () => (body == null ? [] : extractMarkdownHeadings(body)),
    [body],
  );
  const headings = useMemo(() => tocHeadings(allHeadings), [allHeadings]);

  useEffect(() => {
    const root = scrollAreaRef.current;
    if (!root) {
      setActiveHeadingId(null);
      return;
    }
    const viewport = root.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport || headings.length === 0) {
      setActiveHeadingId(null);
      return;
    }

    let frame: number | null = null;
    const updateActiveHeading = () => {
      frame = null;
      const topBoundary = viewport.getBoundingClientRect().top + 24;
      const positions = headings.flatMap((heading) => {
        const element = document.getElementById(heading.id);
        return element && root.contains(element)
          ? [{ id: heading.id, top: element.getBoundingClientRect().top }]
          : [];
      });
      const nextId = activeHeadingFromPositions(
        positions,
        topBoundary,
        viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 2,
      );
      if (nextId == null) return;
      setActiveHeadingId((current) => (current === nextId ? current : nextId));
    };
    const scheduleUpdate = () => {
      if (frame == null) frame = requestAnimationFrame(updateActiveHeading);
    };

    setActiveHeadingId(headings[0].id);
    scheduleUpdate();
    viewport.addEventListener("scroll", scheduleUpdate, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(viewport);

    return () => {
      viewport.removeEventListener("scroll", scheduleUpdate);
      resizeObserver.disconnect();
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [headings, path]);

  const handleHeadingSelect = useCallback((id: string) => {
    const root = scrollAreaRef.current;
    const target = document.getElementById(id);
    if (!root || !target || !root.contains(target)) return;

    setActiveHeadingId(id);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    target.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  return (
    <div className="@container flex h-full flex-col">
      <PanelHeader
        size="compact"
        actions={
          <>
            {headings.length > 0 && (
              <MarkdownTableOfContentsMenu
                headings={headings}
                activeId={activeHeadingId}
                onSelect={handleHeadingSelect}
                className="@min-[64rem]:hidden"
              />
            )}
            {canEdit ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Edit markdown"
                    onClick={() => setEditing(path, true)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Edit markdown</TooltipContent>
              </Tooltip>
            ) : (
              <Badge variant="muted">
                <Lock className="size-3" />
                {readOnlyReason}
              </Badge>
            )}
          </>
        }
      >
        <MarkdownPathBreadcrumb path={path} />
      </PanelHeader>
      {pendingChangeQuery.data && (
        <button
          type="button"
          onClick={() => setEditing(path, true)}
          className="flex items-center gap-2 bg-info/10 px-4 py-2 text-left text-xs text-info hover:bg-info/15"
        >
          <FileDiff className="size-4" />
          <span className="font-medium">Previewing an Agent proposal.</span>
          <span className="text-muted-foreground">
            Open the editor to review, approve, or reject the diff.
          </span>
        </button>
      )}
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <div className="flex w-full gap-8 px-6 py-5">
          <main className="min-w-0 flex-1">
            {isLoading && <p className="text-muted-foreground">Loading…</p>}
            {error && (
              <p className="text-destructive">
                {(error as Error).message || "Failed to load file"}
              </p>
            )}
            {body != null && (
              <motion.div
                key={path}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {frontmatter && (
                  <MarkdownFrontmatter data={frontmatter} basePath={basePath} />
                )}
                <MarkdownBody basePath={basePath} headings={allHeadings}>
                  {body}
                </MarkdownBody>
              </motion.div>
            )}
          </main>
          {headings.length > 0 && (
            <aside className="sticky top-5 hidden max-h-[calc(100vh-10rem)] w-56 shrink-0 self-start overflow-y-auto pr-2 @min-[64rem]:block">
              <MarkdownTableOfContents
                headings={headings}
                activeId={activeHeadingId}
                onSelect={handleHeadingSelect}
              />
            </aside>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
