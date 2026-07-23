import { cn } from "../lib/cn";

export function FilterPills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
            value === opt.value
              ? "border-emerald-800 bg-emerald-800 text-white"
              : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50",
          )}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span
              className={cn(
                "tabular-nums",
                value === opt.value ? "text-emerald-100" : "text-stone-400",
              )}
            >
              {opt.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
