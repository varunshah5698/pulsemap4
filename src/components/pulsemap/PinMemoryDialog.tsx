import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DraftAssistant } from "@/components/pulse/surfaces";
import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { ImagePlus, Loader2, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { TONES, TONE_META, toDateInputValue } from "./tone";

/** The saved memory, handed to callers so the globe can react to it. */
export type PinnedMemory = {
  _id: string;
  title: string;
  note: string;
  placeName: string;
  happenedAt: number;
  mediaUrl: string | null;
  tone: string;
  lat: number;
  lng: number;
};

export function PinMemoryDialog({
  open,
  onOpenChange,
  coords,
  onPinned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coords: { lat: number; lng: number } | null;
  onPinned?: (memory: PinnedMemory) => void;
}) {
  const generateUploadUrl = useMutation(api.memories.generateUploadUrl);
  const createMemory = useMutation(api.memories.create);

  const [title, setTitle] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [tone, setTone] = useState<string>("golden");
  const [visibility, setVisibility] = useState<string>("private");
  const [date, setDate] = useState(toDateInputValue(Date.now()));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [manual, setManual] = useState({ lat: "", lng: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coords) return;
    setManual({ lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) });
  }, [coords]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError("This browser will not share a location. Type the coordinates instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setManual({
          lat: position.coords.latitude.toFixed(5),
          lng: position.coords.longitude.toFixed(5),
        });
        setError(null);
      },
      () => setError("No location given. Type the coordinates instead."),
    );
  }

  function reset() {
    setTitle("");
    setPlaceName("");
    setNote("");
    setTags("");
    setTone("golden");
    setVisibility("private");
    setDate(toDateInputValue(Date.now()));
    setFile(null);
    setManual({ lat: "", lng: "" });
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const lat = Number(coords?.lat ?? manual.lat);
    const lng = Number(coords?.lng ?? manual.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      setError("Pick a point on the map, or type the coordinates.");
      return;
    }

    setSaving(true);
    try {
      let mediaId: string | undefined;
      if (file) {
        const uploadUrl = await generateUploadUrl();
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) throw new Error("The photograph could not be uploaded.");
        const payload = (await response.json()) as { storageId?: string };
        mediaId = payload.storageId;
      }

      const created = await createMemory({
        title,
        note,
        placeName,
        lat,
        lng,
        happenedAt: date ? new Date(`${date}T12:00:00`).getTime() : Date.now(),
        tone: tone as (typeof TONES)[number],
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        visibility: visibility as "private" | "circle" | "public",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mediaId: mediaId as any,
      });

      reset();
      onOpenChange(false);
      onPinned?.({
        _id: created._id,
        title: created.title,
        note: created.note,
        placeName: created.placeName,
        happenedAt: created.happenedAt,
        mediaUrl: created.mediaUrl,
        tone: created.tone,
        lat: created.lat,
        lng: created.lng,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The memory could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="pm-dark max-h-[92vh] overflow-y-auto rounded-[26px] border-white/10 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-[-0.02em] text-white">
            Pin a memory
          </DialogTitle>
          <DialogDescription>
            One place, one note, one date. Keep it private until you decide otherwise.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="size-4 text-[#ff6a2c]" aria-hidden="true" />
              {coords ? (
                <span>
                  {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No point chosen yet — click the map or type coordinates.
                </span>
              )}
            </div>
            <span className="micro-label">Location</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="memory-title">Title</Label>
              <Input
                id="memory-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="First light on the old bridge"
                maxLength={120}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="memory-place">Place</Label>
              <Input
                id="memory-place"
                value={placeName}
                onChange={(event) => setPlaceName(event.target.value)}
                placeholder="Stari Most, Mostar"
                maxLength={120}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="memory-date">When did it happen?</Label>
              <Input
                id="memory-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                max={toDateInputValue(Date.now())}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="memory-tags">Tags, comma separated</Label>
              <Input
                id="memory-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="bridge, morning"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Tone</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((name) => (
                    <SelectItem key={name} value={name}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 rounded-full"
                          style={{ background: TONE_META[name].hex }}
                        />
                        {TONE_META[name].label} — {TONE_META[name].note}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Who can see it?</Label>
              <Select value={visibility} onValueChange={setVisibility}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Only me</SelectItem>
                  <SelectItem value="circle">My circle</SelectItem>
                  <SelectItem value="public">Everyone on the map</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DraftAssistant
            placeName={placeName}
            title={title}
            note={note}
            tags={tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)}
            lat={coords?.lat ?? (manual.lat ? Number(manual.lat) : undefined)}
            lng={coords?.lng ?? (manual.lng ? Number(manual.lng) : undefined)}
            happenedAt={date ? new Date(date).getTime() : undefined}
            onApply={(suggestion) => {
              if (suggestion.title) setTitle(suggestion.title);
              if (suggestion.note) setNote(suggestion.note);
              if (suggestion.tags?.length) setTags(suggestion.tags.join(", "));
            }}
          />

          <div className="flex flex-col gap-2">
            <Label htmlFor="memory-note">The note</Label>
            <Textarea
              id="memory-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              placeholder="Write what you would want to remember in five years."
            />
          </div>

          {!coords ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 rounded-full border-white/12 bg-transparent text-white/85 hover:bg-white/5"
                  onClick={useCurrentLocation}
                >
                  <MapPin className="size-3.5" aria-hidden="true" />
                  Use my current location
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="memory-lat">Latitude</Label>
                <Input
                  id="memory-lat"
                  value={manual.lat}
                  onChange={(event) =>
                    setManual((prev) => ({ ...prev, lat: event.target.value }))
                  }
                  placeholder="43.33730"
                  inputMode="decimal"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="memory-lng">Longitude</Label>
                <Input
                  id="memory-lng"
                  value={manual.lng}
                  onChange={(event) =>
                    setManual((prev) => ({ ...prev, lng: event.target.value }))
                  }
                  placeholder="17.81490"
                  inputMode="decimal"
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="memory-photo">Photograph</Label>
            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 rounded-full border-white/12 bg-transparent px-5 text-white/85 hover:bg-white/5"
                onClick={() => document.getElementById("memory-photo")?.click()}
              >
                <ImagePlus className="size-4" aria-hidden="true" />
                {file ? "Replace image" : "Add image"}
              </Button>
              <input
                id="memory-photo"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              {preview ? (
                <img
                  src={preview}
                  alt=""
                  className="h-16 w-24 rounded-xl border border-white/10 object-cover"
                />
              ) : (
                <span className="text-xs text-muted-foreground">
                  Optional — a phone photo is enough.
                </span>
              )}
            </div>
          </div>

          {error ? (
            <p className="rounded-2xl border-l-2 border-[var(--destructive)] bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
              {error}
            </p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-11 rounded-full px-5 text-white/70 hover:text-white"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="h-11 gap-2 rounded-full px-5 font-semibold"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save memory
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
