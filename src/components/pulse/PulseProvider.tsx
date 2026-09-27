import { api } from "@/convex/_generated/api";
import type { AssistantCard, AssistantProposal, AssistantUi } from "@/convex/assistant";
import type { PulseSnapshot } from "@/convex/intelligence";
import { useAction, useMutation, useQuery } from "convex/react";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Pulse, wired into the whole product.
 *
 * One provider means one conversation and one cache of derived intelligence for
 * every screen: the assistant, the dashboard brief and the place panel are all
 * reading the same profile and the same snapshot. Pages declare where they are
 * with `usePulsePage`, which is how the assistant knows you are looking at
 * Kyoto rather than having to ask.
 */

export type PulsePageContext = {
  route: string;
  placeId?: string;
  placeName?: string;
  memoryId?: string;
  tripId?: string;
  lat?: number;
  lng?: number;
  spanKm?: number;
  filters?: string[];
  label?: string;
};

export type PulseTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards?: AssistantCard[];
  ui?: AssistantUi[];
  proposals?: AssistantProposal[];
  followUps?: string[];
  sources?: string[];
  error?: boolean;
};

type PulseValue = {
  open: boolean;
  openPulse: (seed?: string) => void;
  closePulse: () => void;
  togglePulse: () => void;
  seed: string | null;
  clearSeed: () => void;
  turns: PulseTurn[];
  asking: boolean;
  ask: (message: string) => Promise<void>;
  reset: () => void;
  context: PulsePageContext;
  setContext: (next: Partial<PulsePageContext>) => void;
  snapshot: PulseSnapshot | undefined;
  /** Intelligence is being built for the first time. */
  warming: boolean;
  refresh: (surface?: "dashboard" | "explore" | "globe") => void;
  /** Turns a confirmed proposal into a real change. */
  confirmProposal: (proposal: AssistantProposal) => Promise<void>;
};

const Fallback: PulseValue = {
  open: false,
  openPulse: () => {},
  closePulse: () => {},
  togglePulse: () => {},
  seed: null,
  clearSeed: () => {},
  turns: [],
  asking: false,
  ask: async () => {},
  reset: () => {},
  context: { route: "/" },
  setContext: () => {},
  snapshot: undefined,
  warming: false,
  refresh: () => {},
  confirmProposal: async () => {},
};

const PulseContext = createContext<PulseValue>(Fallback);

export function usePulse(): PulseValue {
  return useContext(PulseContext);
}

/** Declare where the person is, so Pulse can reason about it. */
export function usePulsePage(context: PulsePageContext, deps: unknown[] = []) {
  const { setContext } = usePulse();
  const serialised = JSON.stringify(context);
  useEffect(() => {
    setContext(JSON.parse(serialised) as PulsePageContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialised, setContext, ...deps]);
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function PulseProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [turns, setTurns] = useState<PulseTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [context, setContextState] = useState<PulsePageContext>({ route: "/" });

  const askAction = useAction(api.assistant.ask);
  const confirmAction = useMutation(api.assistant.confirm);
  const refreshAction = useAction(api.intelligence.refresh);
  const snapshot = useQuery(api.intelligence.snapshot) as PulseSnapshot | undefined;

  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const setContext = useCallback((next: Partial<PulsePageContext>) => {
    setContextState((current) => (current.route === next.route && JSON.stringify(current) === JSON.stringify({ ...current, ...next }) ? current : { ...current, ...next }));
  }, []);

  /* Build the profile once per session, then keep the snapshot reactive. */
  const warmed = useRef(false);
  const refresh = useCallback(
    (surface?: "dashboard" | "explore" | "globe") => {
      refreshAction({ surface: surface ?? "dashboard" }).catch(() => {
        // A failed refresh is not worth interrupting anyone over: the surfaces
        // simply keep showing what they already have.
      });
    },
    [refreshAction],
  );

  useEffect(() => {
    if (warmed.current) return;
    warmed.current = true;
    refresh("dashboard");
  }, [refresh]);

  const ask = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || asking) return;
      const history = turns
        .filter((turn) => !turn.error)
        .slice(-6)
        .map((turn) => ({ role: turn.role, content: turn.text }));

      setTurns((current) => [...current, { id: nextId("u"), role: "user", text: trimmed }]);
      setAsking(true);
      try {
        const page = contextRef.current;
        const reply = await askAction({
          message: trimmed,
          context: {
            route: page.route,
            placeId: page.placeId,
            placeName: page.placeName,
            memoryId: page.memoryId as never,
            tripId: page.tripId as never,
            lat: page.lat,
            lng: page.lng,
            spanKm: page.spanKm,
            filters: page.filters,
            label: page.label,
          },
          history,
        });

        setTurns((current) => [
          ...current,
          {
            id: nextId("a"),
            role: "assistant",
            text: reply.answer ?? reply.message ?? "I could not find anything for that.",
            cards: reply.cards,
            ui: reply.ui,
            proposals: reply.proposals,
            followUps: reply.followUps,
            sources: reply.sources,
            error: !reply.ok,
          },
        ]);
      } catch {
        setTurns((current) => [
          ...current,
          {
            id: nextId("a"),
            role: "assistant",
            text: "Something went wrong reaching Pulse. The rest of the app keeps working.",
            error: true,
          },
        ]);
      } finally {
        setAsking(false);
      }
    },
    [askAction, asking, turns],
  );

  const confirmProposal = useCallback(
    async (proposal: AssistantProposal) => {
      try {
        const result = await confirmAction({
          kind: proposal.kind,
          label: proposal.label,
          placeId: proposal.placeId,
          name: proposal.name,
          lat: proposal.lat,
          lng: proposal.lng,
          category: proposal.category,
          tripTitle: proposal.tripTitle,
          destination: proposal.destination,
          days: proposal.days,
          travellers: proposal.travellers,
          budgetMode: proposal.budgetMode,
          currency: proposal.currency,
          items: proposal.items,
        });
        const message =
          "already" in result && result.already
            ? "That one was already saved."
            : `Done — ${"added" in result && result.added ? `${result.added} stops saved.` : "saved."}`;
        setTurns((current) => [
          ...current,
          { id: nextId("a"), role: "assistant", text: message },
        ]);
        refresh("dashboard");
      } catch (error) {
        setTurns((current) => [
          ...current,
          {
            id: nextId("a"),
            role: "assistant",
            text: error instanceof Error ? error.message : "That change did not go through.",
            error: true,
          },
        ]);
      }
    },
    [confirmAction, refresh],
  );

  const value = useMemo<PulseValue>(
    () => ({
      open,
      openPulse: (nextSeed?: string) => {
        setOpen(true);
        if (nextSeed) setSeed(nextSeed);
      },
      closePulse: () => setOpen(false),
      togglePulse: () => setOpen((current) => !current),
      seed,
      clearSeed: () => setSeed(null),
      turns,
      asking,
      ask,
      reset: () => setTurns([]),
      context,
      setContext,
      snapshot,
      warming: snapshot !== undefined && snapshot.profile === null && (snapshot.analyser.memories > 0 || !snapshot.ai.configured),
      refresh,
      confirmProposal,
    }),
    [ask, asking, confirmProposal, context, open, refresh, seed, setContext, snapshot, turns],
  );

  return <PulseContext.Provider value={value}>{children}</PulseContext.Provider>;
}
