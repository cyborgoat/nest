import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

type PickableUser = { uuid: string; id: string; name: string };

const MAX_RESULTS = 8;

export function UserMultiPicker({
  users,
  selectedUuids,
  onChange,
  max,
  placeholder,
  emptyHint,
}: {
  users: PickableUser[];
  selectedUuids: string[];
  onChange: (nextUuids: string[]) => void;
  max?: number;
  placeholder?: string;
  emptyHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const byUuid = useMemo(() => {
    const map = new Map<string, PickableUser>();
    for (const user of users) map.set(user.uuid, user);
    return map;
  }, [users]);
  const selectedUsers = selectedUuids
    .map((uuid) => byUuid.get(uuid))
    .filter((user): user is PickableUser => Boolean(user));

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const candidates = users.filter((user) => !selectedUuids.includes(user.uuid));
    const matched = q
      ? candidates.filter((user) =>
          `${user.name} ${user.id}`.toLowerCase().includes(q),
        )
      : candidates;
    return { shown: matched.slice(0, MAX_RESULTS), total: matched.length };
  }, [users, selectedUuids, query]);

  function pick(user: PickableUser) {
    const next =
      max !== undefined && selectedUuids.length >= max
        ? [user.uuid]
        : [...selectedUuids, user.uuid];
    onChange(next);
    setQuery("");
    if (max === undefined) inputRef.current?.focus();
    else setOpen(false);
  }

  function remove(uuid: string) {
    onChange(selectedUuids.filter((id) => id !== uuid));
  }

  if (users.length === 0 && emptyHint) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted p-4 text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-1.5 shadow-sm focus-within:border-primary"
        onClick={() => inputRef.current?.focus()}
      >
        {selectedUsers.map((user) => (
          <span
            key={user.uuid}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
          >
            {user.name}
            <button
              type="button"
              aria-label={`Remove ${user.name}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(user.uuid);
              }}
              className="rounded-full p-0.5 hover:bg-primary/20"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
          placeholder={selectedUsers.length === 0 ? placeholder : ""}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && query === "" && selectedUsers.length > 0) {
              remove(selectedUsers[selectedUsers.length - 1].uuid);
            } else if (e.key === "Enter" && results.shown.length > 0) {
              e.preventDefault();
              pick(results.shown[0]);
            }
          }}
        />
      </div>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          {results.shown.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              No matching users.
            </p>
          ) : (
            <ul className="max-h-64 overflow-auto py-1">
              {results.shown.map((user) => (
                <li key={user.uuid}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-primary/10",
                    )}
                    onClick={() => pick(user)}
                  >
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      @{user.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results.total > results.shown.length && (
            <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              {results.total - results.shown.length} more — keep typing to narrow
            </p>
          )}
        </div>
      )}
    </div>
  );
}
