import { defaultValueCtx, Editor, rootCtx } from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, Eye, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { fileMutationInvalidations, queryKeys } from "@/lib/query-keys";
import { useEditorStore } from "@/stores/editor";

/** Mounted only while in WYSIWYG mode — remounting on mode switch is what
 * re-parses the raw source into the rich view (and vice versa). */
function MilkdownEditorCore({
  initialMarkdown,
  onChange,
}: {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
}) {
  useEditor((root) =>
    Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialMarkdown);
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onChange(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener),
  );
  return (
    <div className="markdown-body">
      <Milkdown />
    </div>
  );
}

export function MarkdownEditor({ path }: { path: string }) {
  const fileQuery = useQuery({
    queryKey: queryKeys.file(path),
    queryFn: () => api.vaultReadFile(path),
  });
  const queryClient = useQueryClient();
  const setEditing = useEditorStore((s) => s.setEditing);
  const setDirty = useEditorStore((s) => s.setDirty);
  const dirty = useEditorStore((s) => s.dirtyPaths.has(path));

  const installedQuery = useQuery({
    queryKey: queryKeys.installedPacks,
    queryFn: api.hubListInstalled,
  });

  const [markdown, setMarkdown] = useState<string | null>(null);
  const [mode, setMode] = useState<"wysiwyg" | "source">("wysiwyg");
  const savedRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fileQuery.data != null && markdown === null) {
      setMarkdown(fileQuery.data);
      savedRef.current = fileQuery.data;
    }
  }, [fileQuery.data, markdown]);

  // Folder name and pack_id are the same string by convention, but resolve
  // through the installed-packs registry rather than assuming it (matching
  // how LibraryTree/MarkdownViewer look this up) so this doesn't quietly
  // break if that convention ever doesn't hold.
  const rootPath = path.split("/")[0] ?? path;
  const packId =
    installedQuery.data?.find((p) => p.local_path === rootPath)?.pack_id ??
    rootPath;

  const save = useMutation({
    mutationFn: () => api.vaultWriteFile(path, markdown ?? ""),
    onSuccess: () => {
      savedRef.current = markdown;
      setDirty(path, false);
      for (const key of fileMutationInvalidations(packId, path)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success("Saved");
    },
    onError: (e: Error) =>
      toast.error("Could not save", { description: e.message }),
  });

  // `save` is a new object every render (useMutation) and `dirty` changes on
  // every keystroke, so depending on them directly would tear down and
  // re-add this listener constantly. Read the latest values from refs
  // instead, and mount the listener once per file (this component remounts
  // per path anyway via MainTabArea's `key`).
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (!containerRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        if (dirtyRef.current && !saveRef.current.isPending) {
          saveRef.current.mutate();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const updateMarkdown = (next: string) => {
    setMarkdown(next);
    setDirty(path, next !== savedRef.current);
  };

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <PanelHeader
        size="compact"
        actions={
          <>
            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <TabsList>
                <TabsTrigger value="wysiwyg">
                  <Eye className="size-3.5" />
                  Editor
                </TabsTrigger>
                <TabsTrigger value="source">
                  <Code2 className="size-3.5" />
                  Source
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="sm"
              variant={dirty ? "default" : "outline"}
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save className="size-3.5" />
              {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={dirty}
                    onClick={() => setEditing(path, false)}
                  >
                    View
                  </Button>
                </span>
              </TooltipTrigger>
              {dirty && (
                <TooltipContent>Save or discard changes first</TooltipContent>
              )}
            </Tooltip>
          </>
        }
      >
        <span className="truncate text-sm text-muted-foreground">
          {path.split("/").pop()}
        </span>
      </PanelHeader>
      <ScrollArea className="flex-1">
        <div className="max-w-3xl px-6 py-5">
          {markdown === null ? (
            fileQuery.isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : fileQuery.error ? (
              <p className="text-destructive">
                {(fileQuery.error as Error).message}
              </p>
            ) : null
          ) : mode === "wysiwyg" ? (
            <MilkdownProvider>
              <MilkdownEditorCore
                initialMarkdown={markdown}
                onChange={updateMarkdown}
              />
            </MilkdownProvider>
          ) : (
            <textarea
              autoFocus
              value={markdown}
              onChange={(e) => updateMarkdown(e.target.value)}
              spellCheck={false}
              className="min-h-[60vh] w-full resize-none border-none bg-transparent font-mono text-sm outline-none"
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
