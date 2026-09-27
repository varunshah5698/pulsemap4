import { useCallback, useEffect, useRef, useState } from "react";
import type { GlobeFocusRequest } from "./EarthScene";
import type { NotifiedMemory } from "./MemoryNotification";

/** How long the card stays before it steps aside, and how long before queueing. */
const CARD_LIFETIME = 14000;
const REVEAL_FALLBACK = 2600;

/**
 * Turns saved memories into a queue of notification cards.
 *
 * One card is on screen at a time: uploading several memories in a row queues
 * them, and the globe glides from one location to the next.
 */
export function useMemoryStream() {
  const [current, setCurrent] = useState<NotifiedMemory | null>(null);
  const [cardShown, setCardShown] = useState(false);
  const [queued, setQueued] = useState(0);
  const [focus, setFocus] = useState<GlobeFocusRequest | null>(null);

  const busy = useRef(false);
  const queue = useRef<NotifiedMemory[]>([]);
  const nonce = useRef(0);

  const open = useCallback((memory: NotifiedMemory, instant: boolean) => {
    busy.current = true;
    setCurrent(memory);
    setCardShown(instant);
    nonce.current += 1;
    setFocus({
      id: memory._id,
      lat: memory.lat,
      lng: memory.lng,
      nonce: nonce.current,
    });
  }, []);

  const present = useCallback(
    (memory: NotifiedMemory, instant = false) => {
      if (busy.current) {
        queue.current = [...queue.current, memory];
        setQueued(queue.current.length);
        return;
      }
      open(memory, instant);
    },
    [open],
  );

  const dismiss = useCallback(() => {
    busy.current = false;
    setCurrent(null);
    setCardShown(false);
    const next = queue.current.shift();
    setQueued(queue.current.length);
    if (next) window.setTimeout(() => open(next, false), 320);
  }, [open]);

  /**
   * A memory the person picked themselves jumps the queue: the globe turns to
   * it at once instead of waiting behind an upload announcement.
   */
  const showNow = useCallback(
    (memory: NotifiedMemory) => {
      queue.current = queue.current.filter((item) => item._id !== memory._id);
      setQueued(queue.current.length);
      open(memory, false);
    },
    [open],
  );

  /** Called by the globe when the camera has arrived at the location. */
  const markArrived = useCallback(() => setCardShown(true), []);

  useEffect(() => {
    if (!current) return;
    if (!cardShown) {
      // Safety net: if the globe cannot report arrival, still show the card.
      const timer = window.setTimeout(() => setCardShown(true), REVEAL_FALLBACK);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => dismiss(), CARD_LIFETIME);
    return () => window.clearTimeout(timer);
  }, [current, cardShown, dismiss]);

  return { current, cardShown, queued, focus, present, showNow, dismiss, markArrived };
}
