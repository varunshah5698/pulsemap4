import { cn } from "@/lib/utils";
import { MessageSquare, MapPin } from "lucide-react";
import { Link } from "react-router";
import { formatDate, toneMeta } from "./tone";

export type MemoryCardItem = {
  _id: string;
  title: string;
  note: string;
  placeName: string;
  happenedAt: number;
  tone: string;
  tags: string[];
  visibility: string;
  mediaUrl?: string | null;
  authorName?: string;
};

export function MemoryCard({
  memory,
  active = false,
  onHover,
  footer,
}: {
  memory: MemoryCardItem;
  active?: boolean;
  onHover?: (id: string | null) => void;
  footer?: React.ReactNode;
}) {
  const meta = toneMeta(memory.tone);

  return (
    <article
      onMouseEnter={() => onHover?.(memory._id)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        "group relative flex flex-col border bg-card transition-shadow",
        active
          ? "border-[var(--foreground)] shadow-[0_12px_28px_rgba(23,23,15,0.14)]"
          : "border-[var(--rule)] hover:border-[var(--rule-strong)]",
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: meta.hex }}
      />

      {memory.mediaUrl ? (
        <div className="border-b border-[var(--rule)] bg-[var(--muted)]">
          <img
            src={memory.mediaUrl}
            alt=""
            className="h-44 w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-3 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="micro-label" style={{ color: meta.hex }}>
            {meta.label}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(memory.happenedAt)}</p>
        </div>

        <h3 className="font-display text-2xl leading-[1.05]">
          <Link to={`/m/${memory._id}`} className="hover:underline">
            {memory.title}
          </Link>
        </h3>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{memory.placeName}</span>
        </p>

        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{memory.note}</p>

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            <span>{memory.authorName ?? "You"}</span>
          </div>
          <div className="flex items-center gap-2">
            {memory.visibility !== "public" ? (
              <span className="border border-[var(--rule)] px-2 py-0.5 text-[10px] tracking-[0.14em] uppercase">
                {memory.visibility}
              </span>
            ) : null}
            {footer}
          </div>
        </div>
      </div>
    </article>
  );
}
