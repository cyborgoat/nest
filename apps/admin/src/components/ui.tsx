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
    variant === "primary" && "bg-emerald-800 text-white hover:bg-emerald-900",
    variant === "outline" &&
      "border border-stone-200 bg-white text-stone-700 shadow-sm hover:bg-stone-50",
    variant === "danger" &&
      "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    variant === "ghost" && "text-stone-600 hover:bg-stone-100",
    variant === "sidebar" &&
      "text-emerald-100/70 hover:bg-white/5 hover:text-white",
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-stone-200 bg-white p-5 shadow-[0_8px_30px_rgba(28,45,37,.04)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "stone";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold capitalize [&>svg]:size-3",
        tone === "green" && "bg-emerald-50 text-emerald-700",
        tone === "amber" && "bg-amber-50 text-amber-700",
        tone === "stone" && "bg-stone-100 text-stone-600",
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
          : "rounded-xl border border-dashed border-stone-300 bg-white py-20",
      )}
    >
      <div className="mx-auto grid size-10 place-items-center rounded-full bg-emerald-50 text-emerald-700">
        <Check className="size-5" />
      </div>
      <h3 className="mt-3 font-serif text-xl">{title}</h3>
      <p className="mt-1 text-sm text-stone-500">{body}</p>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function RefreshButton({
  onClick,
  busy,
}: {
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onClick}
      aria-label="Refresh"
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

export function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-stone-500">{label}</span>
      {children}
    </div>
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-emerald-950/30 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-stone-200 bg-white p-6 shadow-2xl">
          <DialogPrimitive.Title className="font-serif text-2xl">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mb-5 mt-1 text-sm text-stone-500">
            {description}
          </DialogPrimitive.Description>
          {children}
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded p-1 text-stone-400 hover:bg-stone-100">
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
      <SelectPrimitive.Trigger className="flex min-w-36 items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-left text-sm shadow-sm">
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-stone-400" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-stone-200 bg-white p-1 shadow-xl"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative cursor-default rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-emerald-50 data-[highlighted]:text-emerald-900"
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
}: {
  data: T[];
  columns: ColumnDef<T>[];
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left">
        <thead className="bg-stone-50 text-[11px] uppercase tracking-wider text-stone-500">
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
        <tbody className="divide-y divide-stone-100">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-stone-50/70">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-5 py-3.5 text-sm">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && (
        <div className="p-12 text-center text-sm text-stone-500">
          No matching records.
        </div>
      )}
    </div>
  );
}
