import { useEffect, useRef } from "react";
import { Link } from "react-router";
import "../cinema.css";

/* ------------------------------------------------------------------ *
 * Remote artwork — the only image sources this page loads.
 * ------------------------------------------------------------------ */
const SKY =
  "https://raft-blast-61784561.figma.site/_assets/v11/16b5007d9c93971e26ffe4e0e3e37946f6bd538c.png";
const BACK_FOUR =
  "https://raft-blast-61784561.figma.site/_assets/v11/8a7f8af50e0ce92ec2e228e7b0b4112178c51cf1.png";
const BAZAAR =
  "https://raft-blast-61784561.figma.site/_assets/v11/864afe00e41e2fa20a5aa546e15cb807e0f81384.png";
const SPLIT_LEFT =
  "https://raft-blast-61784561.figma.site/_assets/v11/7536d7b60a1fce482cf6edf3f0bffd3bad5d0f8a.png";
const SPLIT_RIGHT =
  "https://raft-blast-61784561.figma.site/_assets/v11/392db6a6a6b98e868bd7f8d3f55bb719d51e5028.png";
const BRIDGE =
  "https://raft-blast-61784561.figma.site/_assets/v11/c6a6d8ef49bca43f708aa852692942c45ec950d4.png";
const FRAME_TWO =
  "https://raft-blast-61784561.figma.site/_assets/v11/ba75252bab2b1c510987b74837770f7bc8a6b2d4.png";

const ICON_1 =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260730_230438_d526b8b6-8a2e-4e3b-9993-3908acae03a7.png";
const ICON_2 =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260730_230442_140bc25b-b165-4249-904a-f708bff6970e.png";
const ICON_3 =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260730_230448_825949c9-ccdb-4857-b4a6-e349eccc9010.png";

const SIGN_IN = "/auth?returnTo=%2Fdashboard";

/** The five things Pulsemap does, told as cards on the bridge. */
const SIGHTS = [
  {
    label: "How Pulsemap works: drop a pin",
    kicker: "Capture",
    title: "Drop a pin",
    body: "Write the note while the day is still fresh and attach the photo you actually took.",
    pin: ICON_1,
  },
  {
    label: "How Pulsemap works: search the catalogue",
    kicker: "Find",
    title: "Search the catalogue",
    body: "Filter by city, mood or tag, and land on one afternoon in a couple of seconds.",
    pin: ICON_2,
  },
  {
    label: "How Pulsemap works: set a reminder",
    kicker: "Return",
    title: "Set a reminder",
    body: "A quiet nudge a week, a month or a year later, the next time that place matters.",
    pin: ICON_3,
  },
  {
    label: "How Pulsemap works: comment and share",
    kicker: "Thread",
    title: "Comment and share",
    body: "Keep a place private, pass it to your circle, or open it to everyone on the map.",
    pin: ICON_1,
  },
  {
    label: "How Pulsemap works: join a guided trail",
    kicker: "Book",
    title: "Join a guided trail",
    body: "Walk a curated route with a local guide, then keep every pin you collected.",
    pin: ICON_2,
  },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = clamp((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function segmentInOut(s: number, a: number, b: number, c: number, d: number) {
  const enter = smoothstep(a, b, s);
  const exit = smoothstep(c, d, s);
  return { enter, exit, active: enter * (1 - exit) };
}

/**
 * The whole story is one scroll position and one pointer position, read once
 * per frame and written back out as CSS custom properties.
 */
function useCinemaEngine() {
  const originalCards = useRef<HTMLElement[] | null>(null);

  useEffect(() => {
    const section = document.querySelector<HTMLElement>(".cinema-scroll");
    const root = document.documentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const track = document.querySelector<HTMLElement>(".sights-track");
    const sightsControls = document.querySelector<HTMLElement>(".sights-controls");
    const prevButton = document.querySelector<HTMLButtonElement>(".sight-prev");
    const nextButton = document.querySelector<HTMLButtonElement>(".sight-next");

    if (!section || !track || !sightsControls || !prevButton || !nextButton) return;

    if (!originalCards.current) {
      originalCards.current = Array.from(
        track.querySelectorAll<HTMLElement>(".sight-card"),
      );
    }
    const originals = originalCards.current;
    const originalSightCount = originals.length;

    let targetMouseX = 0;
    let targetMouseY = 0;
    let mouseX = 0;
    let mouseY = 0;
    let targetScroll = 0;
    let smoothScroll = 0;
    let initialized = false;
    let rafPending = false;
    let rafId = 0;
    let sightCards: HTMLElement[] = [];
    let activeSight = originalSightCount;

    const getScrollDistance = () =>
      clamp(
        -section.getBoundingClientRect().top,
        0,
        section.offsetHeight - window.innerHeight,
      );

    const setVar = (name: string, value: number | string) => {
      root.style.setProperty(name, typeof value === "number" ? String(value) : value);
    };

    /* ---------------- slider ---------------- */

    function updateSightSlider() {
      if (sightCards.length === 0) return;
      const cardWidth = sightCards[0].offsetWidth;
      const gap = parseFloat(getComputedStyle(track!).columnGap || "0") || 0;
      setVar("--sights-shift", `${-(cardWidth + gap) * activeSight}px`);
      sightCards.forEach((card, index) => {
        card.classList.toggle("is-active", index === activeSight);
      });
    }

    function moveSightSlider(direction: number) {
      activeSight += direction;
      updateSightSlider();
    }

    function selectSightCard(card: HTMLElement) {
      const index = Number(card.dataset.sightIndex);
      if (!Number.isFinite(index)) return;
      activeSight = index;
      updateSightSlider();
    }

    function jumpSightSlider(index: number) {
      track!.classList.add("is-jumping");
      activeSight = index;
      updateSightSlider();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => track!.classList.remove("is-jumping")),
      );
    }

    function normalizeSightSlider() {
      if (activeSight >= originalSightCount * 2) {
        jumpSightSlider(activeSight - originalSightCount);
      } else if (activeSight < originalSightCount) {
        jumpSightSlider(activeSight + originalSightCount);
      }
    }

    function setupSightSlider() {
      track!.replaceChildren();
      for (let setIndex = 0; setIndex < 3; setIndex += 1) {
        originals.forEach((card, cardIndex) => {
          const clone = card.cloneNode(true) as HTMLElement;
          clone.dataset.sightIndex = String(setIndex * originalSightCount + cardIndex);
          clone.classList.remove("is-active");
          track!.appendChild(clone);
        });
      }
      sightCards = Array.from(track!.querySelectorAll<HTMLElement>(".sight-card"));
      activeSight = originalSightCount;
      sightCards.forEach((card) => {
        card.addEventListener("click", () => selectSightCard(card));
        card.addEventListener("keydown", (event) => {
          const key = (event as KeyboardEvent).key;
          if (key === "Enter" || key === " ") {
            event.preventDefault();
            selectSightCard(card);
          }
        });
      });
      track!.addEventListener("transitionend", normalizeSightSlider);
      updateSightSlider();
    }

    /* ---------------- frame ---------------- */

    function update() {
      rafPending = false;

      targetScroll = getScrollDistance();
      if (!initialized || reduceMotion.matches) {
        smoothScroll = targetScroll;
        initialized = true;
      } else {
        smoothScroll = lerp(smoothScroll, targetScroll, 0.14);
      }
      if (Math.abs(smoothScroll - targetScroll) < 0.08) smoothScroll = targetScroll;

      mouseX = lerp(mouseX, targetMouseX, 0.12);
      mouseY = lerp(mouseY, targetMouseY, 0.12);

      const frame2 = segmentInOut(smoothScroll, 560, 900, 1300, 1620);
      const frame3 = segmentInOut(smoothScroll, 1760, 2140, 2540, 2700);
      const progress = clamp(smoothScroll / 2700);
      const introExit = smoothstep(90, 650, smoothScroll);
      const sightsEnterRaw = smoothstep(2760, 3560, smoothScroll);
      const sightsEnter = Math.pow(sightsEnterRaw, 1.55);
      const sightsControlsEnter = smoothstep(3360, 3660, smoothScroll);
      const blurActive = clamp(frame2.active + frame3.active);
      const frame2Opacity = frame2.active * (1 - frame3.enter);
      const splitDrift = Math.pow(frame2.enter, 1.5);
      const panel2Opacity = frame2.active * (1 - frame2.exit);
      const panel3Opacity = frame3.active * (1 - frame3.exit);
      const backScale =
        0.76 + progress * 0.2 + frame2.enter * 0.18 + frame3.enter * 0.16;
      const sharedHeroY = progress * -74;
      const sharedHeroScale = progress * 0.23;
      const sightsScreenTop =
        Math.min(220, Math.max(112, window.innerHeight * 0.19)) - 50;
      const sightsParentTop =
        window.innerHeight - (window.innerHeight - sightsScreenTop) / backScale;

      setVar("--mx", (reduceMotion.matches ? 0 : mouseX).toFixed(4));
      setVar("--my", (reduceMotion.matches ? 0 : mouseY).toFixed(4));

      setVar("--back-opacity", 1 - frame2.active * 0.06);
      setVar("--back-x", `${mouseX * -12}px`);
      setVar("--back-y", `${mouseY * -4}px`);
      setVar("--back-scale", backScale);
      setVar("--four-y", `${10 + progress * 10}vh`);
      setVar("--four-scale", 0.78 + progress * 0.16);
      setVar("--bazaar-y", `${20 - progress * 8}vh`);
      setVar("--blur-px", `${blurActive * 14}px`);
      setVar("--back-brightness", 1 - blurActive * 0.255);
      setVar("--bazaar-blur-px", `${frame2.active * 14}px`);
      setVar(
        "--bazaar-brightness",
        1 - frame2.active * 0.255 - frame3.active * 0.06,
      );
      setVar("--bazaar-saturation", 1 + frame3.active * 0.18);
      setVar("--shade-opacity", "1");
      setVar("--shade-z", frame2.active > 0.02 ? "2" : "0");
      setVar("--shade-top-alpha", blurActive * 0.465);
      setVar("--shade-mid-alpha", blurActive * 0.42);
      setVar("--shade-bottom-alpha", blurActive * 0.51);

      setVar("--title-y", `${introExit * -210}px`);
      setVar("--title-scale", 1 - introExit * 0.08);
      setVar("--title-opacity", 1 - introExit);

      setVar("--bridge-x", `calc(-50% + ${mouseX * 18}px)`);
      setVar("--bridge-y", `${mouseY * 8 + sharedHeroY - frame2.exit * 760}px`);
      setVar("--bridge-bottom", `${5 - frame2.enter * 13}vh`);
      setVar("--bridge-width", `${67.2 + frame2.enter * 37.8}vw`);
      setVar("--bridge-scale", 1.02 + sharedHeroScale + frame2.exit * 0.46);

      setVar("--split-left-x", `calc(-50% + ${-splitDrift * 46}vw + ${mouseX * 22}px)`);
      setVar("--split-left-y", `${mouseY * 10 + sharedHeroY - splitDrift * 180}px`);
      setVar("--split-left-scale", 1 + sharedHeroScale + frame2.enter * 0.74);
      setVar("--split-right-x", `calc(-50% + ${splitDrift * 46}vw + ${mouseX * 22}px)`);
      setVar("--split-right-y", `${mouseY * 10 + sharedHeroY - splitDrift * 180}px`);
      setVar("--split-right-scale", 1 + sharedHeroScale + frame2.enter * 0.74);

      setVar("--frame2-opacity", frame2Opacity);
      setVar("--frame2-x", `calc(-50% + ${mouseX * 10}px)`);
      setVar("--frame2-y", `calc(-50% + ${mouseY * 8 - frame2.exit * 150}px)`);
      setVar("--frame2-scale", 1.06 + frame2.enter * 0.08 + frame2.exit * 0.08);

      setVar("--intro-copy-y", `${introExit * 90}px`);
      setVar("--intro-copy-opacity", 1 - introExit);
      setVar("--panel2-opacity", panel2Opacity);
      setVar("--panel2-y", `calc(-50% + ${-frame2.exit * 86 + (1 - frame2.enter) * 58}px)`);
      setVar("--panel3-opacity", panel3Opacity);
      setVar("--panel3-y", `calc(-50% + ${-frame3.exit * 86 + (1 - frame3.enter) * 58}px)`);

      setVar("--sights-opacity", sightsEnter);
      setVar("--sights-controls-opacity", sightsControlsEnter);
      sightsControls!.classList.toggle("is-ready", sightsControlsEnter > 0.98);
      setVar("--sights-visibility", sightsEnter > 0.01 ? "visible" : "hidden");
      setVar("--sights-y", "0px");
      setVar("--sights-enter-x", `${(1 - sightsEnter) * 420}vw`);
      setVar("--sights-scale", 1 / backScale);
      setVar("--sights-top", `${sightsParentTop}px`);
      setVar("--sights-screen-top", `${sightsScreenTop}px`);

      if (
        Math.abs(smoothScroll - targetScroll) > 0.08 ||
        Math.abs(mouseX - targetMouseX) > 0.001 ||
        Math.abs(mouseY - targetMouseY) > 0.001
      ) {
        requestTick();
      }
    }

    function requestTick() {
      if (rafPending) return;
      rafPending = true;
      rafId = requestAnimationFrame(update);
    }

    const onScroll = () => requestTick();
    const onResize = () => {
      updateSightSlider();
      requestTick();
    };
    const onPointerMove = (event: PointerEvent) => {
      targetMouseX = event.clientX / window.innerWidth - 0.5;
      targetMouseY = event.clientY / window.innerHeight - 0.5;
      requestTick();
    };
    const onPrev = () => moveSightSlider(-1);
    const onNext = () => moveSightSlider(1);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    prevButton.addEventListener("click", onPrev);
    nextButton.addEventListener("click", onNext);
    const onMotionChange = () => requestTick();
    reduceMotion.addEventListener("change", onMotionChange);

    setupSightSlider();
    requestTick();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      prevButton.removeEventListener("click", onPrev);
      nextButton.removeEventListener("click", onNext);
      reduceMotion.removeEventListener("change", onMotionChange);
      track.removeEventListener("transitionend", normalizeSightSlider);
      cancelAnimationFrame(rafId);
      rafPending = false;
    };
  }, []);
}

export default function CinemaStory() {
  useCinemaEngine();

  return (
    <main className="site-shell cinema-root">
      <section
        className="cinema-scroll"
        id="cinema"
        aria-label="Pulsemap cinematic scroll story"
      >
        <div className="stage">
          <div className="world">
            <img className="scene-img sky-img" src={SKY} alt="" />

            <header className="site-header" aria-label="Primary navigation">
              <a className="site-logo" href="#cinema">
                Pulsemap
              </a>
              <nav className="site-nav" aria-label="Main menu">
                <a href="#cinema">Intro</a>
                <a href="#map">Live map</a>
                <a href="#memories">Memories</a>
                <Link to="/explore">Trails</Link>
              </nav>
              <button
                type="button"
                className="language-switcher"
                aria-label="Change language"
              >
                <span>EN</span>
                <span aria-hidden="true">⌄</span>
              </button>
            </header>

            <div className="back-stack">
              <img className="scene-img back-img back-four" src={BACK_FOUR} alt="" />

              <section className="sights-slider" aria-label="Pulsemap capabilities slider">
                <div className="sights-track">
                  {SIGHTS.map((sight) => (
                    <article
                      key={sight.label}
                      className="sight-card"
                      tabIndex={0}
                      role="button"
                      aria-label={sight.label}
                    >
                      <span className="sight-kicker">{sight.kicker}</span>
                      <img className="sight-pin" src={sight.pin} alt="" />
                      <h3>{sight.title}</h3>
                      <p>{sight.body}</p>
                    </article>
                  ))}
                </div>
              </section>

              <img className="scene-img back-img back-bazaar" src={BAZAAR} alt="" />
            </div>

            <div className="sights-controls" aria-label="Slider controls">
              <button
                type="button"
                className="sight-nav sight-prev"
                aria-label="Previous sight"
              >
                ←
              </button>
              <button
                type="button"
                className="sight-nav sight-next"
                aria-label="Next sight"
              >
                →
              </button>
              <Link className="sights-cta" to={SIGN_IN}>
                Start your map
                <span aria-hidden="true">↗</span>
              </Link>
            </div>

            <h1 className="hero-title">PULSEMAP</h1>

            <img
              className="scene-img splitframe-img splitframe-left"
              src={SPLIT_LEFT}
              alt=""
            />
            <img
              className="scene-img splitframe-img splitframe-right"
              src={SPLIT_RIGHT}
              alt=""
            />
            <img className="scene-img bridge-img" src={BRIDGE} alt="" />
            <img className="scene-img frame-two-img" src={FRAME_TWO} alt="" />
            <div className="shade" />
          </div>

          <section className="intro-copy" aria-label="What Pulsemap is">
            <p>
              Pin what happened, exactly where it happened. Pulsemap keeps a living map
              of your memories, threads the notes together, and reminds you when a place
              is worth walking back to.
            </p>
            <div className="hero-tags" aria-label="Pulsemap highlights">
              <span>Live map</span>
              <span>Reminders</span>
              <span>Private by default</span>
            </div>
            <div className="hero-actions">
              <Link className="hero-cta" to={SIGN_IN}>
                Start your map
              </Link>
              <Link className="hero-cta is-quiet" to="/auth">
                Sign in
              </Link>
            </div>
          </section>

          <section
            className="story-panel story-panel-bridge"
            id="map"
            aria-label="How the map works"
          >
            <h2>Every memory gets coordinates.</h2>
            <p>
              A pin is the smallest honest record of a place: a title, a note, a
              photograph, and the day it happened. Drop it once and the map keeps it.
            </p>
            <dl className="facts">
              <div>
                <dt>4,180</dt>
                <dd>Memories pinned by travellers this season</dd>
              </div>
              <div>
                <dt>96</dt>
                <dd>Cities with memories already on the map</dd>
              </div>
            </dl>
          </section>

          <section
            className="story-panel story-panel-bazaar"
            id="memories"
            aria-label="Memories, reminders and trails"
          >
            <h2>The map remembers so you can wander.</h2>
            <p>
              Comments keep the story attached to the place, reminders bring you back to
              it, and guided trails give the whole city a structure worth following.
            </p>
            <Link className="note-button" to="/explore">
              <span aria-hidden="true">↗</span>
              <span>Browse the trail catalogue</span>
            </Link>
          </section>
        </div>
      </section>
    </main>
  );
}
