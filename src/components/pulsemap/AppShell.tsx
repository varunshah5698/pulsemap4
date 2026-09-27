import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Compass, LayoutDashboard, LogOut, Map, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/map", label: "Live map", icon: Map },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
];

export function PulseShell({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-[var(--rule)] bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-6">
          <div className="flex items-center gap-8">
            <Link
              to="/"
              className="font-display text-xl leading-none tracking-tight whitespace-nowrap"
            >
              Pulsemap
            </Link>
            <nav aria-label="Main menu" className="hidden items-center gap-1 md:flex">
              {NAV.map((item) => {
                const active =
                  location.pathname === item.to ||
                  location.pathname.startsWith(`${item.to}/`);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm transition-colors",
                      active
                        ? "border-[var(--foreground)] font-semibold text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <item.icon className="size-4" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-medium">
                {user?.name ?? user?.email ?? "Signed in"}
              </p>
              <p className="micro-label">{user?.role === "admin" ? "Admin" : "Member"}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 rounded-sm border-[var(--rule)]"
              onClick={handleSignOut}
            >
              <LogOut className="size-3.5" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>

        <nav
          aria-label="Main menu, compact"
          className="flex gap-1 overflow-x-auto border-t border-[var(--rule)] px-4 py-2 md:hidden"
        >
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-2 px-3 py-1 text-sm whitespace-nowrap text-muted-foreground"
            >
              <item.icon className="size-3.5" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <div className="flex flex-col gap-6 border-b-2 border-[var(--foreground)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            {eyebrow ? (
              <p className="micro-label mb-3">{eyebrow}</p>
            ) : null}
            <h1 className="font-display text-4xl leading-[0.95] sm:text-5xl">{title}</h1>
            {description ? (
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-3 sm:justify-end">{actions}</div>
          ) : null}
        </div>

        <div className="pt-8">{children}</div>
      </main>

      <footer className="border-t border-[var(--rule)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            Pulsemap — a memory map for places worth returning to. Printed in warm
            paper, ruled in ink.
          </p>
          <p className="font-display text-sm text-foreground">
            {new Date().getFullYear()}
          </p>
        </div>
      </footer>
    </div>
  );
}

export function SectionHeading({
  label,
  title,
  action,
}: {
  label?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 border-b border-[var(--rule)] pb-3">
      <div>
        {label ? <p className="micro-label mb-2">{label}</p> : null}
        <h2 className="font-display text-2xl leading-none">{title}</h2>
      </div>
      {action}
    </div>
  );
}
