import { PulseShell, SectionHeading } from "@/components/pulsemap/AppShell";
import { formatDateTime, formatMoney, toneMeta } from "@/components/pulsemap/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

export default function Admin() {
  const access = useQuery(api.admin.access);
  const isAdmin = access?.isAdmin ?? false;

  const overview = useQuery(api.admin.overview, isAdmin ? {} : "skip");
  const bookings = useQuery(api.bookings.listAll, isAdmin ? {} : "skip");
  const orders = useQuery(api.orders.listAll, isAdmin ? {} : "skip");
  const members = useQuery(api.admin.listMembers, isAdmin ? {} : "skip");
  const memories = useQuery(api.admin.listMemories, isAdmin ? {} : "skip");
  const trails = useQuery(api.experiences.listAll, isAdmin ? {} : "skip");

  const claimWorkspace = useMutation(api.admin.claimWorkspace);
  const setBookingStatus = useMutation(api.bookings.setStatus);
  const refundOrder = useMutation(api.orders.refund);
  const setUserRole = useMutation(api.admin.setUserRole);
  const removeMemory = useMutation(api.memories.remove);
  const updateTrail = useMutation(api.experiences.update);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      await claimWorkspace();
    } catch (claimError) {
      setError(
        claimError instanceof Error ? claimError.message : "The workspace was not claimed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (access === undefined) {
    return (
      <PulseShell eyebrow="Admin" title="Checking access">
        <p className="text-sm text-muted-foreground">One moment…</p>
      </PulseShell>
    );
  }

  if (!access.isAdmin) {
    return (
      <PulseShell
        eyebrow="Admin"
        title={access.hasAnyAdmin ? "Administrators only" : "Claim this workspace"}
        description={
          access.hasAnyAdmin
            ? "This area holds the catalogue, bookings, orders and member roles. Ask an existing administrator to promote your account."
            : "No administrator exists yet. Whoever claims the workspace first becomes its owner, and can then hand the role to anyone else."
        }
      >
        {!access.hasAnyAdmin ? (
          <div className="border border-[var(--rule)] bg-card p-6">
            <ShieldCheck className="size-6" aria-hidden="true" />
            <h2 className="font-display mt-4 text-3xl">Become the first administrator</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              You will be able to publish trails, confirm or cancel bookings, issue
              refunds and moderate public memories. You cannot remove your own access, so
              invite a second administrator early.
            </p>
            {error ? (
              <p className="mt-4 text-sm text-[var(--destructive)]">{error}</p>
            ) : null}
            <Button type="button" className="mt-5 rounded-sm" onClick={claim} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Claim the workspace
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Link to="/dashboard" className="underline">
              Back to your dashboard
            </Link>
          </p>
        )}
      </PulseShell>
    );
  }

  const stats = [
    { label: "Memories", value: overview?.memories ?? 0, hint: `${overview?.publicMemories ?? 0} public` },
    { label: "Bookings", value: overview?.bookings ?? 0, hint: `${overview?.pendingBookings ?? 0} awaiting confirmation` },
    { label: "Revenue collected", value: formatMoney(overview?.revenueCents ?? 0), hint: `${overview?.paidOrders ?? 0} paid orders` },
    { label: "Open orders", value: overview?.openOrders ?? 0, hint: "Waiting on payment" },
    { label: "Accounts", value: overview?.accounts ?? 0, hint: "Signed up to the workspace" },
    { label: "Trails", value: overview?.experiences ?? 0, hint: `${overview?.publishedExperiences ?? 0} published` },
  ];

  return (
    <PulseShell
      eyebrow="Admin"
      title="Workspace control"
      description="The catalogue, the money and the people, on one page. Every change here is live for everyone immediately."
    >
      <div className="grid gap-px border border-[var(--rule)] bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((item) => (
          <div key={item.label} className="bg-card px-5 py-6">
            <p className="micro-label">{item.label}</p>
            <p className="font-display mt-4 text-3xl leading-none">{item.value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{item.hint}</p>
          </div>
        ))}
      </div>

      <Tabs defaultValue="bookings" className="mt-10">
        <TabsList className="rounded-none border border-[var(--rule)] bg-card">
          <TabsTrigger value="bookings" className="rounded-none">
            Bookings
          </TabsTrigger>
          <TabsTrigger value="orders" className="rounded-none">
            Orders
          </TabsTrigger>
          <TabsTrigger value="trails" className="rounded-none">
            Trails
          </TabsTrigger>
          <TabsTrigger value="memories" className="rounded-none">
            Memories
          </TabsTrigger>
          <TabsTrigger value="members" className="rounded-none">
            Members
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="mt-6">
          <SectionHeading label={`${(bookings ?? []).length} rows`} title="Every booking" />
          <div className="border border-[var(--rule)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Trail</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(bookings ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No bookings yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  (bookings ?? []).map((booking) => (
                    <TableRow key={booking._id}>
                      <TableCell>
                        <p className="text-sm font-medium">{booking.guestName}</p>
                        <p className="text-xs text-muted-foreground">
                          {booking.email} · {booking.partySize} people
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{booking.experienceTitle}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(booking.startsAt)}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatMoney(booking.totalCents, booking.currency)}
                        {booking.orderStatus ? (
                          <span className="micro-label mt-1 block">{booking.orderStatus}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <Select
                          value={booking.status}
                          onValueChange={(value) =>
                            setBookingStatus({
                              id: booking._id,
                              status: value as "pending" | "confirmed" | "completed" | "cancelled",
                            })
                          }
                        >
                          <SelectTrigger className="ml-auto w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="confirmed">Confirmed</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="orders" className="mt-6">
          <SectionHeading label={`${(orders ?? []).length} rows`} title="Orders and payments" />
          <div className="border border-[var(--rule)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Trail</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(orders ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      No orders yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  (orders ?? []).map((order) => (
                    <TableRow key={order._id}>
                      <TableCell className="text-sm">{order.buyer}</TableCell>
                      <TableCell className="text-sm">{order.experienceTitle}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatMoney(order.amountCents, order.currency)}
                      </TableCell>
                      <TableCell className="text-xs capitalize">
                        {order.method.replace("_", " ")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Badge variant="outline" className="rounded-none capitalize">
                            {order.status.replace("_", " ")}
                          </Badge>
                          {order.status === "paid" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-sm border-[var(--rule)]"
                              onClick={() => refundOrder({ id: order._id })}
                            >
                              Refund
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="trails" className="mt-6">
          <SectionHeading
            label={`${(trails ?? []).length} trails`}
            title="Catalogue control"
          />
          <div className="hairline-grid border border-[var(--rule)] bg-card">
            {(trails ?? []).map((trail) => (
              <div key={trail._id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ background: toneMeta(trail.tone).hex }}
                />
                <div className="min-w-[220px] flex-1">
                  <p className="text-sm font-medium">{trail.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {trail.city} · {trail.slug}
                  </p>
                </div>
                <Input
                  className="w-28"
                  defaultValue={(trail.priceCents / 100).toFixed(0)}
                  aria-label={`Price for ${trail.title} in euros`}
                  onBlur={(event) => {
                    const euros = Number(event.target.value);
                    if (!Number.isFinite(euros)) return;
                    void updateTrail({ id: trail._id, priceCents: Math.round(euros * 100) });
                  }}
                />
                <Input
                  className="w-20"
                  defaultValue={String(trail.capacity)}
                  aria-label={`Capacity for ${trail.title}`}
                  onBlur={(event) => {
                    const capacity = Number(event.target.value);
                    if (!Number.isFinite(capacity)) return;
                    void updateTrail({ id: trail._id, capacity: Math.max(1, Math.round(capacity)) });
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant={trail.published ? "outline" : "default"}
                  className="rounded-sm"
                  onClick={() =>
                    updateTrail({ id: trail._id, published: !trail.published })
                  }
                >
                  {trail.published ? "Unpublish" : "Publish"}
                </Button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Price and capacity save when you click away from the field.
          </p>
        </TabsContent>

        <TabsContent value="memories" className="mt-6">
          <SectionHeading
            label={`${(memories ?? []).length} pins`}
            title="Moderation"
          />
          <div className="border border-[var(--rule)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Memory</TableHead>
                  <TableHead>Pinned by</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(memories ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                      Nothing pinned yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  (memories ?? []).map((memory) => (
                    <TableRow key={memory._id}>
                      <TableCell className="max-w-[280px]">
                        <p className="truncate text-sm font-medium">{memory.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {memory.placeName} · {formatDateTime(memory.happenedAt)}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{memory.authorName}</TableCell>
                      <TableCell className="text-xs capitalize">{memory.visibility}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={`Delete ${memory.title}`}
                          onClick={() => removeMemory({ id: memory._id })}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="members" className="mt-6">
          <SectionHeading label={`${(members ?? []).length} accounts`} title="Members and roles" />
          <div className="border border-[var(--rule)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(members ?? []).map((member) => (
                  <TableRow key={member._id}>
                    <TableCell className="text-sm font-medium">{member.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {member.email ?? (member.isAnonymous ? "guest session" : "—")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Select
                        value={member.role}
                        onValueChange={(value) =>
                          setUserRole({
                            userId: member._id,
                            role: value as "admin" | "user" | "member",
                          })
                        }
                      >
                        <SelectTrigger className="ml-auto w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="user">User</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </PulseShell>
  );
}
