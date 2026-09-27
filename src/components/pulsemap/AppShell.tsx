import {
  DashboardRail,
  WorkspaceTopBar,
  useOpenReminderCount,
} from "@/components/dashboard/DashboardFrame";
import { PinMemoryDialog } from "@/components/pulsemap/PinMemoryDialog";
import { useAuth } from "@/hooks/use-auth";
import type { ReactNode } from "react";
import { useState } from "react";

/**
 * The shared chrome for every signed-in screen: the same dark rail, tab row
 * and action cluster as the dashboard, so the whole product reads one way.
 */
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
  const { user } = useAuth();
  const openReminders = useOpenReminderCount();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="pm-dark min-h-screen bg-[#0f0f11]">
      <div className="flex">
        <DashboardRail
          onNew={() => setDialogOpen(true)}
          avatarName={user?.name ?? user?.email ?? "Pulsemap"}
          badge={openReminders}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar reminderCount={openReminders} />

          <main className="flex-1 px-5 py-6 sm:px-7">
            <div className="pm-rise flex flex-col gap-4 border-b border-white/[0.06] pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-[1.75rem] leading-[1.05] font-extrabold tracking-[-0.025em] text-white sm:text-[2.15rem]">
                    {title}
                  </h1>
                  {eyebrow ? <span className="pm-chip">{eyebrow}</span> : null}
                </div>
                {description ? (
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">
                    {description}
                  </p>
                ) : null}
              </div>
              {actions ? (
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  {actions}
                </div>
              ) : null}
            </div>

            <div className="pt-7 pb-4">{children}</div>
          </main>

          <footer className="border-t border-white/[0.06] px-5 py-5 sm:px-7">
            <p className="text-xs text-white/35">
              Pulsemap — a memory map for places worth returning to.
            </p>
          </footer>
        </div>
      </div>

      <PinMemoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        coords={null}
      />
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
    <div className="mb-5 flex items-end justify-between gap-4 border-b border-white/[0.06] pb-3">
      <div className="min-w-0">
        {label ? <p className="pm-chip mb-2">{label}</p> : null}
        <h2 className="text-[1.35rem] leading-tight font-bold tracking-[-0.02em] text-white">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}
