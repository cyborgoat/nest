import {
  defaultValueCtx,
  Editor,
  remarkStringifyOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, Eye, Redo2, Save, Undo2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import {
  createEditorHistory,
  currentEditorHistory,
  recordEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
  type EditorHistory,
} from "@/lib/editor-history";
import { detectMarkdownStyle } from "@/lib/markdown-style";
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
        // Milkdown's markdown serializer defaults (bullet `-`, fence `` ` ``,
        // rule `-`, ...) don't remember the file's own conventions, so
        // without this a single-character edit would reformat every list/
        // fence/rule in the document to those defaults on save. Match what
        // the file already uses so a compliant document round-trips as-is.
        ctx.update(remarkStringifyOptionsCtx, (prev) => ({
          ...prev,
          ...detectMarkdownStyle(initialMarkdown),
        }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onChange(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener),
  );
  return (
    <div className="markdown-body markdown-editor-surface">
      <Milkdown />
    </div>
  );
}

function fitSourceHeight(source: HTMLTextAreaElement) {
  source.style.height = "auto";
  source.style.height = `${source.scrollHeight}px`;
}

function renderSourceLine(line: string) {
  const tokenPattern =
    /(`[^`\n]*`|!\[[^\]\n]*\]\([^)\n]*\)|\[[^\]\n]*\]\([^)\n]*\)|<!--.*?-->|^#{1,6}(?=\s)|^>\s?|^(?:[-+*]|\d+\.)\s|^[A-Za-z][\w-]*(?=\s*:)|\*\*|__|~~|\*|_|={3,}|-{3,})/g;
  return line.split(tokenPattern).map((part, index) => {
    if (!part) return null;
    let className: string | undefined;
    if (part.startsWith("<!--")) {
      className = "markdown-source-comment";
    } else if (part.startsWith("`")) {
      className = "markdown-source-code";
    } else if (/!?\[[^\]]*\]\(/.test(part)) {
      className = "markdown-source-link";
    } else if (/^[A-Za-z][\w-]*$/.test(part) && line.startsWith(part)) {
      className = "markdown-source-property";
    } else if (/^#{1,6}$/.test(part)) {
      className = "markdown-source-heading";
    } else if (/^>\s?$/.test(part)) {
      className = "markdown-source-quote";
    } else if (/^(?:[-+*]|\d+\.)\s$/.test(part)) {
      className = "markdown-source-list";
    } else if (/^(?:\*\*|__|~~|\*|_)$/.test(part)) {
      className = "markdown-source-emphasis";
    } else if (/^(?:={3,}|-{3,})$/.test(part)) {
      className = "markdown-source-separator";
    } else {
      className = "markdown-source-marker";
    }
    return (
      <span key={`${index}-${part}`} className={className}>
        {part}
      </span>
    );
  });
}

function renderSourceHighlight(markdown: string) {
  let inFence = false;
  let inFrontmatter = false;
  return markdown.split("\n").map((line, index, lines) => {
    const trimmed = line.trimStart();
    const isFence = /^(```|~~~)/.test(trimmed);
    const isFrontmatterBoundary =
      (index === 0 || inFrontmatter) && trimmed === "---";
    let content;

    if (isFence) {
      content = <span className="markdown-source-fence">{line}</span>;
      inFence = !inFence;
    } else if (inFence) {
      content = <span className="markdown-source-code">{line}</span>;
    } else if (isFrontmatterBoundary) {
      content = <span className="markdown-source-frontmatter">{line}</span>;
      inFrontmatter = !inFrontmatter;
    } else {
      content = renderSourceLine(line);
    }

    return (
      <span key={index}>
        {content}
        {index < lines.length - 1 ? "\n" : null}
      </span>
    );
  });
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
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [mode, setMode] = useState<"wysiwyg" | "source">("source");
  const savedRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (fileQuery.data == null) return;

    if (markdown === null) {
      setMarkdown(fileQuery.data);
      setHistory(createEditorHistory(fileQuery.data));
      savedRef.current = fileQuery.data;
      return;
    }

    // File mutations such as a Source Control discard refresh this query.
    // Adopt the new persisted content when the buffer is clean, but never
    // overwrite unsaved typing during an incidental query refetch.
    if (!dirty && fileQuery.data !== savedRef.current) {
      setMarkdown(fileQuery.data);
      setHistory(createEditorHistory(fileQuery.data));
      savedRef.current = fileQuery.data;
    }
  }, [fileQuery.data, markdown, dirty]);

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
  const undo = () => {
    if (!history || history.index === 0) return;
    const next = undoEditorHistory(history);
    const value = currentEditorHistory(next);
    setHistory(next);
    setMarkdown(value);
    setDirty(path, value !== savedRef.current);
    setEditorRevision((revision) => revision + 1);
  };
  const redo = () => {
    if (!history || history.index >= history.entries.length - 1) return;
    const next = redoEditorHistory(history);
    const value = currentEditorHistory(next);
    setHistory(next);
    setMarkdown(value);
    setDirty(path, value !== savedRef.current);
    setEditorRevision((revision) => revision + 1);
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (!containerRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        if (dirtyRef.current && !saveRef.current.isPending) {
          saveRef.current.mutate();
        }
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.key.toLowerCase() === "y" ||
          (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        if (!containerRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        redoRef.current();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z"
      ) {
        if (!containerRef.current?.contains(document.activeElement)) return;
        e.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const updateMarkdown = (next: string) => {
    setMarkdown(next);
    setHistory((current) =>
      current ? recordEditorHistory(current, next) : createEditorHistory(next),
    );
    setDirty(path, next !== savedRef.current);
  };

  useLayoutEffect(() => {
    if (mode !== "source") return;
    const source = sourceRef.current;
    if (!source) return;
    fitSourceHeight(source);
  }, [markdown, mode]);

  useEffect(() => {
    if (mode !== "source") return;
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const source = sourceRef.current;
      if (source) fitSourceHeight(source);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [mode]);

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <PanelHeader
        size="compact"
        actions={
          <>
            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <TabsList className="h-7 rounded-md p-0.5">
                <TabsTrigger value="wysiwyg" className="h-6 px-2 py-0 text-xs">
                  <Eye className="size-3.5" />
                  Editor
                </TabsTrigger>
                <TabsTrigger value="source" className="h-6 px-2 py-0 text-xs">
                  <Code2 className="size-3.5" />
                  Source
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Undo"
              disabled={!history || history.index === 0}
              onClick={undo}
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Redo"
              disabled={!history || history.index >= history.entries.length - 1}
              onClick={redo}
            >
              <Redo2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant={dirty ? "default" : "outline"}
              className="h-7"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              <Save className="size-3.5" />
              {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={save.isPending}
              onClick={() => {
                if (dirty) setCancelOpen(true);
                else setEditing(path, false);
              }}
            >
              <X className="size-3.5" />
              Cancel
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="View rendered markdown"
                    disabled={dirty}
                    onClick={() => setEditing(path, false)}
                  >
                    <Eye className="size-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {dirty
                  ? "Save or discard changes first"
                  : "View rendered markdown"}
              </TooltipContent>
            </Tooltip>
          </>
        }
      >
        <span className="truncate text-sm text-muted-foreground">
          {path.split("/").pop()}
        </span>
      </PanelHeader>
      <ScrollArea className="markdown-editor-scroll min-h-0 flex-1">
        <div className="markdown-editor-layout max-w-3xl px-6 py-5">
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
                key={editorRevision}
                initialMarkdown={markdown}
                onChange={updateMarkdown}
              />
            </MilkdownProvider>
          ) : (
            <div className="relative flex flex-1">
              <pre
                aria-hidden
                className="pointer-events-none absolute inset-0 m-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground"
              >
                {renderSourceHighlight(markdown)}
              </pre>
              <textarea
                ref={sourceRef}
                autoFocus
                value={markdown}
                onChange={(e) => updateMarkdown(e.target.value)}
                spellCheck={false}
                rows={1}
                className="markdown-editor-surface relative z-10 m-0 block resize-none overflow-hidden border-none bg-transparent p-0 font-sans text-sm leading-relaxed text-transparent caret-foreground outline-none selection:bg-primary/20 selection:text-foreground"
              />
            </div>
          )}
        </div>
      </ScrollArea>
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores the last saved content and exits the editor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const saved = savedRef.current ?? "";
                setMarkdown(saved);
                setHistory(createEditorHistory(saved));
                setDirty(path, false);
                setCancelOpen(false);
                setEditing(path, false);
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
