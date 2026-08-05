import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as SelectPrimitive from "@radix-ui/react-select";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Check, ChevronDown, RefreshCw, X } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "../lib/cn";

export function Button({
  variant = "primary",
  size = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "danger" | "ghost" | "sidebar";
  size?: "default" | "sm" | "icon";
}) {
  return (
    <button className={cn(buttonClass(variant, size), className)} {...props} />
  );
}

export function buttonClass(
  variant: "primary" | "outline" | "danger" | "ghost" | "sidebar" = "primary",
  size: "default" | "sm" | "icon" = "default",
) {
  return cn(
    "inline-flex items-center gap-2 rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:size-4",
    size === "sm"
      ? "px-2.5 py-1.5 text-xs"
      : size === "icon"
        ? "size-9 justify-center"
        : "px-3.5 py-2",
    variant === "primary" &&
      "bg-primary text-primary-foreground hover:bg-primary/90",
    variant === "outline" &&
      "border border-border bg-card text-foreground shadow-sm hover:bg-muted",
    variant === "danger" &&
      "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20",
    variant === "ghost" && "text-muted-foreground hover:bg-muted",
    variant === "sidebar" &&
      "text-sidebar-muted hover:bg-sidebar-active hover:text-sidebar-foreground",
  );
}

export const CARD_CLASSES =
  "rounded-xl border border-border bg-card p-5 shadow-[0_8px_30px_rgba(0,0,0,.04)]";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <section className={cn(CARD_CLASSES, className)}>{children}</section>;
}

export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "stone" | "red";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold capitalize [&>svg]:size-3",
        tone === "green" && "bg-primary/10 text-primary",
        tone === "amber" && "bg-amber-50 text-amber-800",
        tone === "red" && "bg-destructive/10 text-destructive",
        tone === "stone" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function Empty({
  title,
  body,
  compact = false,
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "text-center",
        compact
          ? "py-8"
          : "rounded-xl border border-dashed border-border bg-card py-20",
      )}
    >
      <div className="mx-auto grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        <Check className="size-5" />
      </div>
      <h3 className="mt-3 text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function RefreshButton({
  onClick,
  busy,
  label = "Refresh",
}: {
  onClick: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
    >
      <RefreshCw className={busy ? "animate-spin" : ""} />
    </Button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-card p-6 shadow-2xl">
          <DialogPrimitive.Title className="text-2xl font-semibold tracking-tight">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mb-5 mt-1 text-sm text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Select({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger className="flex min-w-36 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm shadow-sm">
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xl"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative cursor-default rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-primary/10 data-[highlighted]:text-primary"
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function DataTable<T>({
  data,
  columns,
  loading = false,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left">
        <thead className="bg-muted text-[11px] uppercase tracking-wider text-muted-foreground">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} className="px-5 py-3 font-semibold">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border">
          {loading && data.length === 0
            ? Array.from({ length: 5 }, (_, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((_, colIndex) => (
                    <td key={colIndex} className="px-5 py-3.5">
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/60">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-5 py-3.5 text-sm">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && data.length === 0 && (
        <div className="p-12 text-center text-sm text-muted-foreground">
          No matching records.
        </div>
      )}
    </div>
  );
}

export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
