export const TONES = ["quiet", "golden", "bright", "storm", "night"] as const;
export type ToneName = (typeof TONES)[number];

export const TONE_META: Record<
  ToneName,
  { label: string; hex: string; note: string }
> = {
  quiet: { label: "Quiet", hex: "#3f6b5a", note: "Slow, green, unhurried" },
  golden: { label: "Golden", hex: "#c8871b", note: "Late light on warm stone" },
  bright: { label: "Bright", hex: "#c2452d", note: "Loud, busy, copper" },
  storm: { label: "Storm", hex: "#3a4e6d", note: "Rain and grey water" },
  night: { label: "Night", hex: "#4a3b63", note: "Lamplight, low ceilings" },
};

export function toneMeta(tone: string) {
  return TONE_META[(tone as ToneName) in TONE_META ? (tone as ToneName) : "quiet"];
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const longFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(timestamp: number) {
  return dateFormat.format(new Date(timestamp));
}

export function formatDateTime(timestamp: number) {
  return timeFormat.format(new Date(timestamp));
}

/** "27 September 2026", for memory cards and notifications. */
export function longDate(timestamp: number) {
  return longFormat.format(new Date(timestamp));
}

/** "just now" / "6 min ago" / "yesterday" / "21 Sep", for activity lists. */
export function relativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function toDateInputValue(timestamp: number) {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatMoney(cents: number, currency = "eur") {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** "in 3 days" / "yesterday", for reminder rows. */
export function relativeDay(timestamp: number) {
  const diff = timestamp - Date.now();
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}
