import { Component, type ReactNode } from "react";

/**
 * Keeps a WebGL or third-party map failure from taking the whole page down.
 *
 * The globe and the flat map both drive real browser APIs — WebGL contexts,
 * Google's own DOM — and either can fail on a machine that is out of GPU
 * memory or has the context pulled from under it. When that happens the person
 * should still get their memories, the search rail and the rest of the page,
 * rather than a blank screen.
 */
export class StageBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Pulsemap stage failed:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
