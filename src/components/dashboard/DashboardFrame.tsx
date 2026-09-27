import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Bell,
  Compass,
  LayoutDashboard,
  Map,
  Plus,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation } from "react-router";

export const DASHBOARD_TABS = ["overview", "memories", "reminders", "visits"] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

const TAB_LABELS: Record<DashboardTab, string> = {
  overview: "Overview",
  memories: "Memories",
  reminders: "Reminders",
  visits: "Visits",
};

const DESTINATIONS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/map", label: "Live map", icon: Map },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function DashboardRail({
  onNew,
  avatarName,
  badge,
}: {
  onNew: () => void;
  avatarName: string;
  badge: number;
}) {
  const location = useLocation();

  return (
    <aside className="pm-rail sticky top-4 ml-4 hidden h-[calc(100vh-2rem)] w-[74px] shrink-0 flex-col items-center justify-between py-5 sm:flex">
      <div className="flex flex-col items-center gap-7">
        <button
          type="button"
          onClick={onNew}
          aria-label="Pin a new memory"
          className="grid size-12 place-items-center rounded-2xl text-[#ff6a2c] transition-transform hover:scale-[1.06] active:scale-95"
        >
          <Plus className="size-7" strokeWidth={2.6} aria-hidden="true" />
        </button>

        <nav aria-label="Workspace" className="flex flex-col items-center gap-3">
          {DESTINATIONS.map((item) => {
            const active =
              location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                data-active={active}
                className="pm-rail-link"
              >
                <item.icon className="size-5" aria-hidden="true" />
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="relative">
        <span
          className="grid size-11 place-items-center rounded-full bg-[#2a2a2f] text-[13px] font-semibold text-white"
          aria-hidden="true"
        >
          {initials(avatarName) || "PM"}
        </span>
        {badge > 0 ? (
          <span className="absolute -top-1 -right-1 grid min-w-[20px] place-items-center rounded-full bg-[#ff6a2c] px-1.5 py-0.5 text-[10px] font-bold text-white">
            {badge}
          </span>
        ) : null}
      </div>
    </aside>
  );
}

export function DashboardTopBar({
  tab,
  onTab,
  reminderCount,
}: {
  tab: DashboardTab;
  onTab: (next: DashboardTab) => void;
  reminderCount: number;
}) {
  const location = useLocation();

  return (
    <header className="border-b border-white/[0.06] px-5 sm:px-7">
      <div className="flex items-center justify-between gap-6">
        <nav
          aria-label="Dashboard sections"
          className="flex flex-1 items-center gap-7 overflow-x-auto pt-6 pb-0"
        >
          {DASHBOARD_TABS.map((item) => (
            <button
              key={item}
              type="button"
              className="pm-tab"
              data-active={item === tab}
              aria-current={item === tab ? "true" : undefined}
              onClick={() => onTab(item)}
            >
              {TAB_LABELS[item]}
            </button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          <Link
            to="/explore"
            className="pm-icon-btn"
            aria-label="Search the catalogue"
            title="Search the catalogue"
          >
            <Search className="size-5" aria-hidden="true" />
          </Link>
          <Link
            to="/admin"
            className="pm-icon-btn pm-icon-square"
            aria-label="Workspace settings"
            title="Workspace settings"
          >
            <Settings className="size-5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={() => onTab("reminders")}
            className="pm-icon-btn pm-icon-circle relative"
            aria-label={`Reminders, ${reminderCount} open`}
            title="Reminders"
          >
            <Bell className="size-5" aria-hidden="true" />
            {reminderCount > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 grid min-w-[20px] place-items-center rounded-full bg-[#ff6a2c] px-1.5 py-0.5 text-[10px] font-bold text-white">
                {reminderCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* Compact destinations for narrow screens, where the rail is hidden. */}
      <nav aria-label="Workspace" className="flex gap-2 pb-4 sm:hidden">
        {DESTINATIONS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "pm-panel-soft flex items-center gap-2 px-3 py-2 text-xs text-white/70",
              location.pathname === item.to && "text-white",
            )}
          >
            <item.icon className="size-3.5" aria-hidden="true" />
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function GreetingBanner({
  name,
  memories,
  reminders,
  nextLabel,
}: {
  name: string;
  memories: number;
  reminders: number;
  nextLabel: string;
}) {
  return (
    <section className="pm-banner pm-rise flex items-center justify-between gap-6 px-6 py-7 sm:px-8">
      <span
        className="pm-banner-blob size-40 bg-white/40"
        style={{ top: "-30%", right: "18%" }}
        aria-hidden="true"
      />
      <span
        className="pm-banner-blob size-32 bg-[#3d1a05]"
        style={{ bottom: "-45%", right: "34%" }}
        aria-hidden="true"
      />

      <div className="relative min-w-0">
        <h1 className="text-[1.65rem] leading-tight font-extrabold tracking-[-0.02em] text-white sm:text-[2rem]">
          Hello, {name}!
        </h1>
        <p className="mt-2 text-[0.9rem] font-medium text-white/85">
          {memories} {memories === 1 ? "memory" : "memories"} on your map ·{" "}
          {reminders} {reminders === 1 ? "reminder" : "reminders"} waiting.
        </p>
        <p className="mt-1 truncate text-xs text-white/65">{nextLabel}</p>
      </div>

      <Link
        to="/map"
        className="pm-circle-cta relative shrink-0"
        aria-label="Open the live map"
      >
        <ArrowRight className="size-5" aria-hidden="true" />
      </Link>
    </section>
  );
}
