import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { diffLines } from "diff";
import { Check, Eye, FileDiff, Redo2, Save, Undo2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { useVaultTransfer } from "@/components/library/VaultTransferController";
import { Button } from "@/components/ui/button";
import { DiscardChangesDialog } from "@/components/ui/discard-changes-dialog";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { isPointOverEditor } from "@/lib/drop-targets";
import { appErrorMessage } from "@/lib/errors";
import {
  createEditorHistory,
  currentEditorHistory,
  recordEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
  type EditorHistory,
} from "@/lib/editor-history";
import { canEditPack, packEditBlockReason } from "@/lib/pack-permissions";
import { fileMutationInvalidations, queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  markdownForVaultDrop,
  parentDir,
} from "@/lib/vault-paths";
import { MarkdownPathBreadcrumb } from "@/components/viewer/MarkdownPathBreadcrumb";
import { useEditorStore } from "@/stores/editor";
import { useUiStore } from "@/stores/ui";

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
  return markdown.split("\n").map((line, index) => {
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
      <div key={index} className="markdown-editor-line">
        <span className="markdown-editor-gutter">{index + 1}</span>
        <span className="markdown-editor-line-content">
          {line.length > 0 ? content : "\u00a0"}
        </span>
      </div>
    );
  });
}

export function MarkdownEditor({ path }: { path: string }) {
  const pendingChangeQuery = useQuery({
    queryKey: queryKeys.pendingChatFileChange(path),
    queryFn: () => api.chatGetPendingFileChange(path),
  });
  const fileQuery = useQuery({
    queryKey: queryKeys.file(path),
    queryFn: () => api.vaultReadFile(path),
  });
  const queryClient = useQueryClient();
  const setEditing = useEditorStore((s) => s.setEditing);
  const setDirty = useEditorStore((s) => s.setDirty);
  const clearPathsUnder = useUiStore((s) => s.clearPathsUnder);
  const { startTransfer, conflictDialog } = useVaultTransfer();
  const dirty = useEditorStore((s) => s.dirtyPaths.has(path));

  const installedQuery = useQuery({
    queryKey: queryKeys.installedPacks,
    queryFn: api.hubListInstalled,
  });

  const [markdown, setMarkdown] = useState<string | null>(null);
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
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
    onError: (e) => toast.error("Could not save", { description: appErrorMessage(e) }),
  });

  const reviewAgentChange = useMutation({
    mutationFn: (approve: boolean) => {
      if (!pendingChangeQuery.data) throw new Error("No pending Agent change");
      return api.chatReviewFileChange(pendingChangeQuery.data.id, approve);
    },
    onSuccess: (_void, approve) => {
      const change = pendingChangeQuery.data;
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingChatFileChange(path) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.file(path) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.allChatMessages });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tree });
      void queryClient.invalidateQueries({ queryKey: queryKeys.index });
      if (change && ((approve && change.new_content == null) || (!approve && change.old_content == null))) {
        clearPathsUnder(path);
      }
      setEditing(path, false);
      toast.success(approve ? "Agent change approved" : "Agent change rejected");
    },
    onError: (error) => toast.error("Could not review Agent change", { description: appErrorMessage(error) }),
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
  };
  const redo = () => {
    if (!history || history.index >= history.entries.length - 1) return;
    const next = redoEditorHistory(history);
    const value = currentEditorHistory(next);
    setHistory(next);
    setMarkdown(value);
    setDirty(path, value !== savedRef.current);
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
    const source = sourceRef.current;
    if (!source) return;
    fitSourceHeight(source);
  }, [markdown]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      const source = sourceRef.current;
      if (source) fitSourceHeight(source);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const insertAtCaret = (snippet: string) => {
    const source = sourceRef.current;
    const current = markdown ?? "";
    if (!source) {
      const next =
        current.length === 0
          ? snippet
          : current.endsWith("\n")
            ? `${current}${snippet}`
            : `${current}\n${snippet}`;
      updateMarkdown(next);
      return;
    }
    const start = source.selectionStart;
    const end = source.selectionEnd;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const needsLeading =
      before.length > 0 && !before.endsWith("\n") && !before.endsWith(" ");
    const text = `${needsLeading ? "\n" : ""}${snippet}`;
    const next = `${before}${text}${after}`;
    updateMarkdown(next);
    requestAnimationFrame(() => {
      const pos = before.length + text.length;
      source.focus();
      source.setSelectionRange(pos, pos);
    });
  };

  const insertAtCaretRef = useRef(insertAtCaret);
  insertAtCaretRef.current = insertAtCaret;
  const pathRef = useRef(path);
  pathRef.current = path;
  const startTransferRef = useRef(startTransfer);
  startTransferRef.current = startTransfer;

  const installedPack = installedQuery.data?.find(
    (p) => p.local_path === rootPath,
  );
  const hubAuthQuery = useQuery({
    queryKey: queryKeys.hubAuth,
    queryFn: api.hubAuthState,
  });
  const canDropImport = installedPack
    ? canEditPack(installedPack, hubAuthQuery.data?.user ?? null)
    : false;
  const canDropImportRef = useRef(canDropImport);
  canDropImportRef.current = canDropImport;
  const installedPackRef = useRef(installedPack);
  installedPackRef.current = installedPack;
  const hubUserRef = useRef(hubAuthQuery.data?.user ?? null);
  hubUserRef.current = hubAuthQuery.data?.user ?? null;
  const clearPathsUnderRef = useRef(clearPathsUnder);
  clearPathsUnderRef.current = clearPathsUnder;
  const setEditingRef = useRef(setEditing);
  setEditingRef.current = setEditing;
  const setDirtyRef = useRef(setDirty);
  setDirtyRef.current = setDirty;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        if (event.payload.type !== "drop") return;
        const { x, y } = event.payload.position;
        if (!isPointOverEditor(x, y)) return;
        const paths = event.payload.paths ?? [];
        if (paths.length === 0) return;
        if (!canDropImportRef.current) {
          toast.error("Cannot import here", {
            description: installedPackRef.current
              ? packEditBlockReason(
                  installedPackRef.current,
                  hubUserRef.current,
                )
              : "You don't have edit access to this pack.",
          });
          return;
        }
        const destDir = parentDir(pathRef.current);
        void startTransferRef.current({
          destDir,
          sourcePaths: paths,
          operation: "copy",
          onComplete: (result) => {
            for (const key of fileMutationInvalidations(packId)) {
              void queryClient.invalidateQueries({ queryKey: key });
            }
            for (const replaced of result.replaced_paths) {
              clearPathsUnderRef.current(replaced);
              setEditingRef.current(replaced, false);
              setDirtyRef.current(replaced, false);
            }
            if (!result.replaced_paths.includes(pathRef.current)) {
              const snippets = result.written_files
                .filter((written) => written !== pathRef.current)
                .map((written) =>
                  markdownForVaultDrop(pathRef.current, written),
                );
              if (snippets.length) insertAtCaretRef.current(snippets.join("\n"));
            }
          },
        });
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [packId, queryClient]);

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col"
      data-markdown-editor
    >
      <PanelHeader
        size="compact"
        actions={
          pendingChangeQuery.data ? (
            <>
              <Button size="sm" variant="outline" className="h-7" disabled={reviewAgentChange.isPending} onClick={() => reviewAgentChange.mutate(false)}>
                <X className="size-3.5" /> Reject
              </Button>
              <Button size="sm" className="h-7" disabled={reviewAgentChange.isPending} onClick={() => reviewAgentChange.mutate(true)}>
                <Check className="size-3.5" /> {reviewAgentChange.isPending ? "Applying…" : "Approve"}
              </Button>
            </>
          ) : <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Undo"
              disabled={!canDropImport || !history || history.index === 0}
              onClick={undo}
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Redo"
              disabled={
                !canDropImport ||
                !history ||
                history.index >= history.entries.length - 1
              }
              onClick={redo}
            >
              <Redo2 className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant={dirty ? "default" : "outline"}
              className="h-7"
              disabled={!canDropImport || !dirty || save.isPending}
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
        <MarkdownPathBreadcrumb path={path} />
      </PanelHeader>
      {pendingChangeQuery.data ? (
        <AgentProposalDiff
          oldContent={pendingChangeQuery.data.old_content ?? ""}
          newContent={pendingChangeQuery.data.new_content ?? ""}
          operation={pendingChangeQuery.data.operation}
        />
      ) : <ScrollArea className="markdown-editor-scroll min-h-0 flex-1">
        <div className="markdown-editor-layout w-full py-5 pl-2 pr-6">
          {markdown === null ? (
            fileQuery.isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : fileQuery.error ? (
              <p className="text-destructive">
                {appErrorMessage(fileQuery.error)}
              </p>
            ) : null
          ) : (
            <div
              className="relative flex flex-1"
              style={
                {
                  "--markdown-editor-gutter": `${Math.max(
                    1.75,
                    String((markdown.match(/\n/g)?.length ?? 0) + 1).length *
                      0.55 +
                      0.85,
                  )}rem`,
                } as CSSProperties
              }
            >
              <pre
                aria-hidden
                className="pointer-events-none absolute inset-0 m-0 font-sans text-sm leading-relaxed text-foreground markdown-editor-text"
              >
                {renderSourceHighlight(markdown)}
              </pre>
              <textarea
                ref={sourceRef}
                autoFocus
                value={markdown}
                disabled={!canDropImport}
                onChange={(e) => updateMarkdown(e.target.value)}
                spellCheck={false}
                rows={1}
                className="markdown-editor-surface relative z-10 m-0 block resize-none overflow-hidden border-none bg-transparent py-0 pr-0 font-sans text-sm leading-relaxed text-transparent caret-foreground outline-none selection:bg-primary/20 selection:text-foreground markdown-editor-text"
              />
            </div>
          )}
        </div>
      </ScrollArea>}
      <DiscardChangesDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        description="This restores the last saved content and exits the editor."
        cancelLabel="Keep editing"
        onConfirm={() => {
          const saved = savedRef.current ?? "";
          setMarkdown(saved);
          setHistory(createEditorHistory(saved));
          setDirty(path, false);
          setCancelOpen(false);
          setEditing(path, false);
        }}
      />
      {conflictDialog}
    </div>
  );
}

function AgentProposalDiff({ oldContent, newContent, operation }: { oldContent: string; newContent: string; operation: string }) {
  const rows = buildInlineDiffRows(oldContent, newContent);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 bg-info/10 px-4 py-2 text-xs text-info">
        <FileDiff className="size-4" />
        <span className="font-medium">Agent proposal · {operation}</span>
        <span className="text-muted-foreground">Review the diff, then approve or reject it.</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-w-[36rem] font-mono text-xs leading-5">
          <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background px-3 py-1.5 font-sans text-[11px] font-medium text-muted-foreground">
            <span><span className="mr-1 text-destructive">−</span>Current</span>
            <span><span className="mr-1 text-success">+</span>Agent proposal</span>
          </div>
          {rows.map((row, index) => (
            <div
              key={index}
              className={cn(
                "grid min-h-5 grid-cols-[3rem_3rem_1.5rem_minmax(0,1fr)]",
                row.kind === "removed" && "bg-destructive/10 text-destructive",
                row.kind === "added" && "bg-success/10 text-success",
              )}
            >
              <span className="select-none border-r border-border/50 px-2 text-right text-muted-foreground/60">{row.oldLine ?? ""}</span>
              <span className="select-none border-r border-border/50 px-2 text-right text-muted-foreground/60">{row.newLine ?? ""}</span>
              <span className="select-none text-center font-semibold">{row.kind === "removed" ? "−" : row.kind === "added" ? "+" : ""}</span>
              <pre className="min-w-0 whitespace-pre-wrap break-all pr-3">{row.text || " "}</pre>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

type InlineDiffRow = {
  kind: "context" | "added" | "removed";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

function buildInlineDiffRows(oldContent: string, newContent: string): InlineDiffRow[] {
  let oldLine = 1;
  let newLine = 1;
  const rows: InlineDiffRow[] = [];

  for (const change of diffLines(oldContent, newContent)) {
    const lines = change.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) {
      if (change.removed) {
        rows.push({ kind: "removed", oldLine: oldLine++, newLine: null, text });
      } else if (change.added) {
        rows.push({ kind: "added", oldLine: null, newLine: newLine++, text });
      } else {
        rows.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text });
      }
    }
  }
  return rows;
}
