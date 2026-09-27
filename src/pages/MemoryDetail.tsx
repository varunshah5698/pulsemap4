import { PulseShell, SectionHeading } from "@/components/pulsemap/AppShell";
import {
  formatDate,
  formatDateTime,
  relativeDay,
  toneMeta,
} from "@/components/pulsemap/tone";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, BellRing, Loader2, MapPin, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

const PRESETS = [
  { label: "In a week", days: 7 },
  { label: "In a month", days: 30 },
  { label: "In a year", days: 365 },
];

const OUTLINE_BUTTON =
  "h-11 gap-2 rounded-full border-white/12 bg-transparent px-5 text-white/85 hover:bg-white/5";

export default function MemoryDetail() {
  const { id } = useParams<{ id: string }>();
  const memoryId = id as Id<"memories"> | undefined;
  const navigate = useNavigate();
  const { user } = useAuth();

  const memory = useQuery(
    api.memories.get,
    memoryId ? { id: memoryId } : "skip",
  );
  const comments = useQuery(
    api.comments.listForMemory,
    memoryId ? { memoryId } : "skip",
  );
  const reminders = useQuery(api.reminders.listMine);

  const addComment = useMutation(api.comments.add);
  const removeComment = useMutation(api.comments.remove);
  const createReminder = useMutation(api.reminders.create);
  const removeMemory = useMutation(api.memories.remove);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (memory === undefined) {
    return (
      <PulseShell eyebrow="Memory" title="Loading this pin">
        <p className="text-sm text-white/50">Fetching the note…</p>
      </PulseShell>
    );
  }

  if (memory === null) {
    return (
      <PulseShell eyebrow="Memory" title="This pin is not visible">
        <p className="max-w-lg text-sm leading-6 text-white/55">
          The memory may have been deleted, or it belongs to someone who keeps it
          private.{" "}
          <Link to="/explore" className="text-[#ff6a2c] hover:underline">
            Back to the catalogue
          </Link>
          .
        </p>
      </PulseShell>
    );
  }

  const meta = toneMeta(memory.tone);
  const mine = memory.userId === user?._id;
  const myReminders = (reminders ?? []).filter((item) => item.memoryId === memory._id);

  async function handleReminder(days: number) {
    await createReminder({
      title: `Return to ${memory!.title}`,
      body: memory!.placeName,
      dueAt: Date.now() + days * 24 * 60 * 60 * 1000,
      memoryId: memory!._id,
    });
  }

  async function handleComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPosting(true);
    try {
      await addComment({ memoryId: memory!._id, body: draft });
      setDraft("");
    } catch (commentError) {
      setError(
        commentError instanceof Error ? commentError.message : "The comment was not saved.",
      );
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete() {
    if (!memory) return;
    await removeMemory({ id: memory._id });
    navigate("/explore");
  }

  return (
    <PulseShell
      eyebrow={`${meta.label} · ${formatDate(memory.happenedAt)}`}
      title={memory.title}
      description={memory.placeName}
      actions={
        <>
          <Button asChild variant="outline" className={OUTLINE_BUTTON}>
            <Link to="/map">
              <MapPin className="size-4" aria-hidden="true" />
              See it on the map
            </Link>
          </Button>
          {mine ? (
            <Button
              type="button"
              variant="outline"
              className={OUTLINE_BUTTON}
              onClick={handleDelete}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          ) : null}
        </>
      }
    >
      <Link
        to="/explore"
        className="mb-6 inline-flex items-center gap-2 text-sm text-white/45 transition-colors hover:text-white"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the catalogue
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          {memory.mediaUrl ? (
            <div className="pm-panel mb-8 overflow-hidden">
              <img src={memory.mediaUrl} alt="" className="w-full object-cover" />
            </div>
          ) : (
            <div
              className="pm-panel mb-8 flex h-48 items-end overflow-hidden p-6"
              style={{
                background: `linear-gradient(150deg, ${meta.hex}55 0%, ${meta.hex}18 100%)`,
              }}
            >
              <span className="pm-chip">No photograph on this pin</span>
            </div>
          )}

          <p className="text-[1.05rem] leading-8 text-white/85">
            {memory.note || "No note was written."}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {memory.tags.map((tag) => (
              <span key={tag} className="pm-chip">
                {tag}
              </span>
            ))}
          </div>

          <div className="mt-10">
            <SectionHeading
              label={`${(comments ?? []).length} in the thread`}
              title="Comments"
            />
            <div className="pm-panel overflow-hidden">
              <ul className="hairline-grid">
                {(comments ?? []).length === 0 ? (
                  <li className="px-5 py-8 text-center text-sm text-white/40">
                    No comments yet. Say what you saw there.
                  </li>
                ) : (
                  (comments ?? []).map((comment) => (
                    <li key={comment._id} className="flex items-start gap-4 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="pm-chip">
                          {comment.authorName} · {formatDateTime(comment.createdAt)}
                        </p>
                        <p className="mt-3 text-sm leading-6 text-white/80">
                          {comment.body}
                        </p>
                      </div>
                      {comment.userId === user?._id ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8 shrink-0 text-white/40 hover:text-white"
                          aria-label="Delete comment"
                          onClick={() => removeComment({ id: comment._id })}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </div>

            <form onSubmit={handleComment} className="mt-5 flex flex-col gap-3">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                placeholder="Add a note to this place…"
                aria-label="Add a comment"
                className="rounded-2xl"
              />
              {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
              <div>
                <Button
                  type="submit"
                  className="h-11 rounded-full px-5 font-semibold"
                  disabled={posting || draft.trim().length === 0}
                >
                  {posting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Post comment
                </Button>
              </div>
            </form>
          </div>
        </div>

        <aside className="flex flex-col gap-5">
          <section className="pm-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="pm-panel-title">On the record</h2>
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ background: meta.hex }}
              />
            </div>
            <dl className="mt-4 flex flex-col gap-4 text-sm">
              <div>
                <dt className="text-white/40">Place</dt>
                <dd className="mt-1 text-white/85">{memory.placeName}</dd>
              </div>
              <div>
                <dt className="text-white/40">Happened</dt>
                <dd className="mt-1 text-white/85">{formatDate(memory.happenedAt)}</dd>
              </div>
              <div>
                <dt className="text-white/40">Coordinates</dt>
                <dd className="mt-1 font-mono text-xs text-white/85">
                  {memory.lat.toFixed(5)}, {memory.lng.toFixed(5)}
                </dd>
              </div>
              <div>
                <dt className="text-white/40">Visibility</dt>
                <dd className="mt-1 text-white/85 capitalize">{memory.visibility}</dd>
              </div>
              <div>
                <dt className="text-white/40">Pinned by</dt>
                <dd className="mt-1 text-white/85">{memory.authorName}</dd>
              </div>
            </dl>
          </section>

          <section className="pm-panel p-5">
            <h2 className="pm-panel-title flex items-center gap-2">
              <BellRing className="size-4 text-[#ff6a2c]" aria-hidden="true" />
              Come back to this place
            </h2>
            <p className="mt-3 text-[13px] leading-6 text-white/50">
              Pulsemap will hold the note until you are ready to read it again.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleReminder(preset.days)}
                  className="flex items-center gap-2 rounded-full border border-white/12 px-3.5 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-[#ff6a2c] hover:text-white"
                >
                  <BellRing className="size-3.5" aria-hidden="true" />
                  {preset.label}
                </button>
              ))}
            </div>
            {myReminders.length > 0 ? (
              <ul className="mt-4 border-t border-white/[0.07] pt-3">
                {myReminders.map((reminder) => (
                  <li
                    key={reminder._id}
                    className="py-1 text-xs text-white/45 tabular-nums"
                  >
                    {formatDateTime(reminder.dueAt)} · {relativeDay(reminder.dueAt)}
                    {reminder.done ? " · done" : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="pm-panel p-5">
            <h2 className="pm-panel-title">Walk this city with a guide</h2>
            <p className="mt-3 text-[13px] leading-6 text-white/50">
              Curated routes pass the places people still pin years later. Pick a date and
              a guide does the rest.
            </p>
            <Button asChild className="mt-4 h-11 w-full rounded-full font-semibold">
              <Link to="/explore">Browse trails</Link>
            </Button>
          </section>
        </aside>
      </div>
    </PulseShell>
  );
}
