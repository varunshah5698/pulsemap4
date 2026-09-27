import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import "../../auth.css";

/* The same remote artwork family the landing page tells its story with. */
const SKY =
  "https://raft-blast-61784561.figma.site/_assets/v11/16b5007d9c93971e26ffe4e0e3e37946f6bd538c.png";
const BRIDGE =
  "https://raft-blast-61784561.figma.site/_assets/v11/c6a6d8ef49bca43f708aa852692942c45ec950d4.png";

/* Fixed particle field: deterministic, so the layout never reflows. */
const PARTICLES = [
  { left: "12%", bottom: "18%", delay: "0s", duration: "17s" },
  { left: "24%", bottom: "34%", delay: "3.4s", duration: "21s" },
  { left: "38%", bottom: "12%", delay: "7.2s", duration: "19s" },
  { left: "57%", bottom: "28%", delay: "1.8s", duration: "23s" },
  { left: "68%", bottom: "9%", delay: "9.6s", duration: "18s" },
  { left: "81%", bottom: "24%", delay: "5.1s", duration: "22s" },
  { left: "92%", bottom: "40%", delay: "12.4s", duration: "20s" },
];

const MARKS = ["Explore", "Memories", "Discover"];

export function AuthStage({
  headline,
  support,
  navPrompt,
  navLabel,
  navHref,
  children,
}: {
  headline: string[];
  support: string;
  navPrompt: string;
  navLabel: string;
  navHref: string;
  children: ReactNode;
}) {
  // Decorative coordinates come from the live catalogue, never invented.
  const trails = useQuery(api.experiences.list, {});
  const featured = (trails ?? [])[0] ?? null;

  return (
    <section className="pm-auth relative min-h-screen w-full overflow-hidden">
      {/* z-0 — cinematic travel background */}
      <div className="pm-in-fade absolute inset-0 z-0">
        <img
          className="pm-auth-media h-full w-full object-cover object-center"
          src={SKY}
          alt=""
          aria-hidden="true"
        />
      </div>

      {/* z-1 — atmosphere */}
      <div className="pm-overlay-x absolute inset-0 z-[1]" aria-hidden="true" />
      <div className="pm-overlay-y absolute inset-0 z-[1]" aria-hidden="true" />
      <div className="pm-vignette absolute inset-0 z-[1]" aria-hidden="true" />
      <div className="pm-grain absolute inset-0 z-[1]" aria-hidden="true" />

      {/* z-2 — decorative depth */}
      <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true">
        <img
          className="pm-bridge absolute bottom-[-6%] left-1/2 w-[min(118vw,1560px)] max-w-none -translate-x-1/2 object-contain"
          src={BRIDGE}
          alt=""
        />
        <div className="pm-horizon absolute bottom-[34%] left-0 h-px w-full opacity-40" />
        {PARTICLES.map((particle) => (
          <span
            key={`${particle.left}-${particle.delay}`}
            className="pm-particle"
            style={{
              left: particle.left,
              bottom: particle.bottom,
              animationDelay: particle.delay,
              animationDuration: particle.duration,
            }}
          />
        ))}
      </div>

      {/* z-10 — navigation and content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="pm-in-down flex items-start justify-between gap-6 px-6 py-7 sm:px-10">
          <div>
            <Link
              to="/"
              className="font-display text-[26px] leading-none tracking-[-0.01em] text-white"
            >
              PulseMap
            </Link>
            <p className="mt-2 text-xs tracking-[0.02em] text-white/50">
              Travel differently.
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <span className="hidden text-sm text-white/60 sm:inline">{navPrompt}</span>
            <Link
              to={navHref}
              className="pm-pill flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white"
            >
              {navLabel}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </header>

        <main className="flex flex-1 items-center px-6 pb-14 sm:px-10">
          <div className="mx-auto grid w-full max-w-[1180px] items-center gap-12 lg:grid-cols-[1.05fr_minmax(0,430px)] lg:gap-16">
            <div className="pm-in-up hidden lg:block" style={{ animationDelay: "120ms" }}>
              <p className="text-[11px] font-semibold tracking-[0.22em] text-white/45 uppercase">
                Your world is waiting
              </p>
              <h1 className="font-display mt-6 text-5xl leading-[0.95] text-white xl:text-7xl">
                {headline.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </h1>
              <p className="mt-7 max-w-md text-[15px] leading-7 text-white/65">{support}</p>
            </div>

            <div className="w-full">{children}</div>
          </div>
        </main>

        <footer className="flex flex-wrap items-end justify-between gap-4 px-6 pb-8 sm:px-10">
          <div className="flex flex-wrap items-center gap-3 text-[11px] tracking-[0.16em] text-white/40 uppercase">
            {MARKS.map((mark, index) => (
              <span key={mark} className="flex items-center gap-3">
                {index > 0 ? (
                  <span className="h-3 w-px bg-white/20" aria-hidden="true" />
                ) : null}
                {mark}
              </span>
            ))}
          </div>

          {featured ? (
            <p className="text-right font-mono text-[11px] tracking-[0.08em] text-white/40">
              {Math.abs(featured.lat).toFixed(4)}° N / {Math.abs(featured.lng).toFixed(4)}° E
              <span className="ml-3 text-white/30">
                {featured.city} · {featured.title}
              </span>
            </p>
          ) : null}
        </footer>
      </div>
    </section>
  );
}
