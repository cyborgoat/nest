import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export function InputGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 min-w-0 items-center rounded-lg border border-border bg-card shadow-sm transition focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function InputGroupAddon({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center pl-3 text-muted-foreground [&>svg]:size-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function InputGroupInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
