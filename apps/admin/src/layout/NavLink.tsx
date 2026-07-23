import React, { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function NavLink({
  to,
  icon,
  label,
  badge,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-muted transition hover:bg-sidebar-active hover:text-sidebar-foreground [&.active]:bg-sidebar-active [&.active]:text-sidebar-foreground"
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
        className: "size-4",
      })}
      <span>{label}</span>
      {badge ? (
        <span className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-sidebar-foreground">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
