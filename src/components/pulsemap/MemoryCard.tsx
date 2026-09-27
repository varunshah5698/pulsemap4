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
        "pm-panel pm-panel-link group flex flex-col overflow-hidden",
        active && "border-[#ff6a2c]/60",
      )}
    >
      <div
        className="relative h-44"
        style={{
          backgroundImage: memory.mediaUrl
            ? `url(${memory.mediaUrl})`
            : `linear-gradient(150deg, ${meta.hex}66, ${meta.hex}18)`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <span
          className="absolute top-4 left-4 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-white uppercase"
          style={{ background: meta.hex }}
        >
          {meta.label}
        </span>
        <span className="absolute top-4 right-4 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white/80 backdrop-blur-sm">
          {formatDate(memory.happenedAt)}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <h3 className="text-[1.15rem] leading-snug font-bold tracking-[-0.01em] text-white">
          <Link to={`/m/${memory._id}`} className="hover:text-[#ff6a2c]">
            {memory.title}
          </Link>
        </h3>

        <p className="flex items-center gap-1.5 text-xs text-white/45">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{memory.placeName}</span>
        </p>

        <p className="line-clamp-3 text-[13px] leading-6 text-white/55">{memory.note}</p>

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            <span className="truncate">{memory.authorName ?? "You"}</span>
          </div>
          <div className="flex items-center gap-2">
            {memory.visibility !== "public" ? (
              <span className="pm-chip">{memory.visibility}</span>
            ) : null}
            {footer}
          </div>
        </div>
      </div>
    </article>
  );
}
