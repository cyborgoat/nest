import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export function ItemGroup({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col", className)} {...props} />;
}

export function Item({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-4 rounded-lg px-4 py-4 transition-colors",
        className,
      )}
      {...props}
    />
  );
}

export function ItemMedia({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&>svg]:size-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ItemContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 flex-1", className)} {...props} />;
}

export function ItemTitle({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("text-sm font-semibold text-foreground", className)}
      {...props}
    />
  );
}

export function ItemDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function ItemActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex shrink-0 items-center gap-3", className)}
      {...props}
    />
  );
}
