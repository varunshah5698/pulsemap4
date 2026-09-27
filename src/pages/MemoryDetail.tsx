import { PulseShell, SectionHeading } from "@/components/pulsemap/AppShell";
import {
  formatDate,
  formatDateTime,
  relativeDay,
  toneMeta,
} from "@/components/pulsemap/tone";
import { Badge } from "@/components/ui/badge";
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
        <p className="text-sm text-muted-foreground">Fetching the note…</p>
      </PulseShell>
    );
  }

  if (memory === null) {
    return (
      <PulseShell eyebrow="Memory" title="This pin is not visible">
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">
          The memory may have been deleted, or it belongs to someone who keeps it
          private.{" "}
          <Link to="/explore" className="underline">
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
          <Button asChild variant="outline" className="gap-2 rounded-sm border-[var(--rule)]">
            <Link to="/map">
              <MapPin className="size-4" aria-hidden="true" />
              See it on the map
            </Link>
          </Button>
          {mine ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2 rounded-sm border-[var(--rule)]"
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
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the catalogue
      </Link>

      <div
        aria-hidden="true"
        className="h-[4px] w-full"
        style={{ background: meta.hex }}
      />

      <div className="mt-8 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div>
          {memory.mediaUrl ? (
            <img
              src={memory.mediaUrl}
              alt=""
              className="mb-8 w-full border border-[var(--rule)] object-cover"
            />
          ) : (
            <div
              className="mb-8 flex h-48 items-end p-6"
              style={{
                background: `linear-gradient(180deg, ${meta.hex}1f 0%, ${meta.hex}40 100%)`,
              }}
            >
              <p className="micro-label" style={{ color: meta.hex }}>
                No photograph on this pin
              </p>
            </div>
          )}

          <p className="text-lg leading-8">{memory.note || "No note was written."}</p>

          <div className="mt-6 flex flex-wrap gap-2">
            {memory.tags.map((tag) => (
              <Badge key={tag} variant="outline" className="rounded-none">
                {tag}
              </Badge>
            ))}
          </div>

          <div className="mt-12">
            <SectionHeading
              label={`${(comments ?? []).length} in the thread`}
              title="Comments"
            />
            <ul className="hairline-grid border border-[var(--rule)] bg-card">
              {(comments ?? []).length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No comments yet. Say what you saw there.
                </li>
              ) : (
                (comments ?? []).map((comment) => (
                  <li key={comment._id} className="flex items-start gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="micro-label">
                        {comment.authorName} · {formatDateTime(comment.createdAt)}
                      </p>
                      <p className="mt-2 text-sm leading-6">{comment.body}</p>
                    </div>
                    {comment.userId === user?._id ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-8 shrink-0"
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

            <form onSubmit={handleComment} className="mt-5 flex flex-col gap-3">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                placeholder="Add a note to this place…"
                aria-label="Add a comment"
              />
              {error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : null}
              <div>
                <Button type="submit" disabled={posting || draft.trim().length === 0}>
                  {posting ? <Loader2 className="size-4 animate-spin" /> : null}
                  Post comment
                </Button>
              </div>
            </form>
          </div>
        </div>

        <aside className="flex flex-col gap-8">
          <section className="border border-[var(--rule)] bg-card px-5 py-5">
            <p className="micro-label">On the record</p>
            <dl className="mt-4 flex flex-col gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Place</dt>
                <dd className="mt-1">{memory.placeName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Happened</dt>
                <dd className="mt-1">{formatDate(memory.happenedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Coordinates</dt>
                <dd className="mt-1 font-mono text-xs">
                  {memory.lat.toFixed(5)}, {memory.lng.toFixed(5)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Visibility</dt>
                <dd className="mt-1 capitalize">{memory.visibility}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Pinned by</dt>
                <dd className="mt-1">{memory.authorName}</dd>
              </div>
            </dl>
          </section>

          <section className="border border-[var(--rule)] bg-card px-5 py-5">
            <p className="micro-label">Reminders</p>
            <h2 className="font-display mt-3 text-2xl leading-tight">
              Come back to this place
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pulsemap will hold the note until you are ready to read it again.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-sm border-[var(--rule)]"
                  onClick={() => handleReminder(preset.days)}
                >
                  <BellRing className="size-3.5" aria-hidden="true" />
                  {preset.label}
                </Button>
              ))}
            </div>
            {myReminders.length > 0 ? (
              <ul className="mt-4 border-t border-[var(--rule)] pt-4 text-xs text-muted-foreground">
                {myReminders.map((reminder) => (
                  <li key={reminder._id} className="py-1">
                    {formatDateTime(reminder.dueAt)} · {relativeDay(reminder.dueAt)}
                    {reminder.done ? " · done" : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="border border-[var(--rule)] bg-card px-5 py-5">
            <p className="micro-label">Guided trails</p>
            <h2 className="font-display mt-3 text-2xl leading-tight">
              Walk this city with a guide
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Curated routes pass the places people still pin years later. Pick a date and
              a guide does the rest.
            </p>
            <Button asChild className="mt-4 w-full rounded-sm">
              <Link to="/explore">Browse trails</Link>
            </Button>
          </section>
        </aside>
      </div>
    </PulseShell>
  );
}
