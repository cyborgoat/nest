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
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-emerald-100/70 transition hover:bg-white/5 hover:text-white [&.active]:bg-white/10 [&.active]:text-white"
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, {
        className: "size-4",
      })}
      <span>{label}</span>
      {badge ? (
        <span className="ml-auto rounded-full bg-lime-200 px-2 py-0.5 text-[10px] font-bold text-emerald-950">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
