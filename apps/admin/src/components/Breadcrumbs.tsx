import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

export function Breadcrumbs({
  items,
}: {
  items: { label: string; to?: string }[];
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-3 flex items-center gap-1.5 text-xs text-stone-500"
    >
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="size-3 text-stone-300" />}
          {item.to ? (
            <Link to={item.to} className="hover:text-emerald-700 hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-stone-700">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
