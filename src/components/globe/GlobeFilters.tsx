import { Input } from "@/components/ui/input";
import { TONES, TONE_META } from "@/components/pulsemap/tone";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

export type GlobeScope = "all" | "mine";

function chipClass(active: boolean) {
  return cn(
    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
    active
      ? "border-[#ff6a2c] bg-[#ff6a2c] text-white"
      : "border-white/12 text-white/55 hover:border-white/25 hover:text-white",
  );
}

export function GlobeFilters({
  search,
  onSearch,
  scope,
  onScope,
  tone,
  onTone,
  shown,
  total,
  className,
}: {
  search: string;
  onSearch: (next: string) => void;
  scope: GlobeScope;
  onScope: (next: GlobeScope) => void;
  tone: string;
  onTone: (next: string) => void;
  shown: number;
  total: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            className="absolute top-3 left-3.5 size-3.5 text-white/35"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search memories"
            aria-label="Search memories"
            className="h-10 w-52 rounded-full border-white/10 bg-white/[0.04] pl-9 text-xs"
          />
        </div>

        <div
          className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1"
          role="group"
          aria-label="Whose memories"
        >
          {(
            [
              { value: "all", label: "Everyone" },
              { value: "mine", label: "Only mine" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onScope(option.value)}
              aria-pressed={scope === option.value}
              className={cn(
                "rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors",
                scope === option.value
                  ? "bg-[#ff6a2c] text-white"
                  : "text-white/55 hover:text-white",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="pm-chip">
          {shown === total ? `${total} pins` : `${shown} of ${total}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onTone("any")}
          className={chipClass(tone === "any")}
        >
          Any tone
        </button>
        {TONES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onTone(name)}
            className={chipClass(tone === name)}
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: TONE_META[name].hex }}
            />
            {TONE_META[name].label}
          </button>
        ))}
      </div>
    </div>
  );
}
