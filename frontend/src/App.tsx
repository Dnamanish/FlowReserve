import { useEffect, useState } from "react";
import { getEvents, createReservation, getUserReservations } from "./api";
import type { Event, UserReservation } from "./api";
import { Layers, Search, ChevronDown, SlidersHorizontal } from "lucide-react";

const categories = ["All events", "Available", "Almost full", "Waitlist only"];

const TEST_USER_ID = 1;

function App() {
  const [events, setEvents] = useState<Event[]>([]);
  const [userReservations, setUserReservations] = useState<UserReservation[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All events");

  const [reservingEventId, setReservingEventId] = useState<number | null>(null);
  const [reservationMessage, setReservationMessage] = useState("");
  const [reservationError, setReservationError] = useState(false);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const data = await getEvents();
        setEvents(data);
        setError("");
      } catch {
        setError("Couldn't load events. Check your backend connection.");
        setLoading(false);
        return;
      }

      try {
        const reservations = await getUserReservations(TEST_USER_ID);
        setUserReservations(reservations);
      } catch {
        setReservationError(true);
        setReservationMessage(
          "Events loaded, but your reservation statuses couldn't be loaded.",
        );
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  async function refreshEvents() {
    const updatedEvents = await getEvents();
    setEvents(updatedEvents);
  }

  async function refreshUserReservations() {
    const reservations = await getUserReservations(TEST_USER_ID);
    setUserReservations(reservations);
  }

  async function handleReserve(event: Event) {
    setReservingEventId(event.id);
    setReservationMessage("");
    setReservationError(false);

    try {
      const reservation = await createReservation(event.id, TEST_USER_ID);

      if (reservation.status === "confirmed") {
        setReservationMessage(`Reservation confirmed for ${event.name}!`);
      } else if (reservation.status === "waiting") {
        setReservationMessage(
          `${event.name} is full. You've joined the waitlist.`,
        );
      }

      // Refresh availability and this user's reservations.
      try {
        await Promise.all([refreshEvents(), refreshUserReservations()]);
      } catch {
        setReservationError(true);
        setReservationMessage(
          "Your reservation was created, but the dashboard couldn't refresh. Please reload the page.",
        );
      }
    } catch (error) {
      setReservationError(true);
      setReservationMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );

      // Recover the current state if the request failed,
      // for example because the user already has a reservation.
      try {
        await Promise.all([refreshEvents(), refreshUserReservations()]);
      } catch {
        // Keep the original reservation error visible.
      }
    } finally {
      setReservingEventId(null);
    }
  }

  const filteredEvents = events.filter((event) => {
    const matchesSearch = event.name
      .toLowerCase()
      .includes(search.toLowerCase());

    const percentage =
      event.capacity > 0 ? (event.confirmed_count / event.capacity) * 100 : 0;

    const matchesCategory =
      category === "All events" ||
      (category === "Available" && event.remaining_spots > 0) ||
      (category === "Almost full" &&
        event.remaining_spots > 0 &&
        percentage >= 75) ||
      (category === "Waitlist only" && event.remaining_spots === 0);

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-[#f2f5fb] font-['Plus_Jakarta_Sans'] text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex h-[52px] max-w-[1024px] items-center px-5">
          <a href="/" className="-ml-32 flex shrink-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Layers size={17} strokeWidth={2.4} />
            </span>
            <span className="text-[14px] font-bold tracking-tight text-slate-800">
              FlowReserve
            </span>
          </a>

          <div className="ml-20 flex h-full items-center gap-1">
            <a
              href="/"
              className="flex h-8 items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-medium text-indigo-600"
            >
              Events
            </a>
            <button
              type="button"
              className="ml-3 h-8 rounded-md border border-transparent px-3 text-[11px] text-slate-500 hover:bg-slate-50"
            >
              My Reservations
            </button>
          </div>

          <div className="ml-auto -mr-25 flex items-center gap-3">
            <div className="hidden h-8 items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 text-[11px] text-slate-500 sm:flex">
              <Search size={13} />
              <span>Quick search...</span>
              <span className="rounded border border-slate-200 bg-white px-1 text-[9px]">
                ⌘K
              </span>
            </div>
            <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-semibold text-indigo-600">
              MK
              <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full border border-white bg-emerald-500" />
            </div>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <p className="mb-3 text-xs text-slate-500">
          Home <span className="mx-2">›</span> Events
        </p>

        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Discover Events
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Reserve your spot or join the FIFO waitlist when an event is full.
            </p>
          </div>
          <span className="w-fit rounded-full bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            <span className="mr-1">●</span> Live availability
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by event name, venue or organizer..."
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              All dates <ChevronDown size={14} className="text-slate-500" />
            </button>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setCategory("All events");
              }}
              className="flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800"
            >
              <SlidersHorizontal size={14} /> Filters
            </button>
          </div>
        </div>

        {reservationMessage && (
          <div
            role="status"
            className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
              reservationError
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {reservationMessage}
            <button
              type="button"
              onClick={() => setReservationMessage("")}
              className="ml-3 font-semibold underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                category === item
                  ? "bg-indigo-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600 hover:border-indigo-200"
              }`}
            >
              {item}
            </button>
          ))}
          <span className="self-center text-xs text-slate-500 sm:ml-auto">
            {filteredEvents.length} events
          </span>
        </div>

        {loading ? (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
            Loading events...
          </div>
        ) : error ? (
          <div className="mt-10 rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
            {error}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-3 font-semibold underline"
            >
              Retry
            </button>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <h2 className="font-semibold text-slate-800">No events found</h2>
            <p className="mt-2 text-sm text-slate-500">
              Try another search or clear your filters.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredEvents.map((event) => {
              const full = event.remaining_spots === 0;

              const percentage =
                event.capacity > 0
                  ? Math.min(
                      100,
                      (event.confirmed_count / event.capacity) * 100,
                    )
                  : 0;

              const userReservation = userReservations.find(
                (reservation) =>
                  reservation.event_id === event.id &&
                  (reservation.status === "confirmed" ||
                    reservation.status === "waiting"),
              );

              const alreadyReserved = Boolean(userReservation);

              const buttonLabel =
                reservingEventId === event.id
                  ? "Processing..."
                  : userReservation?.status === "confirmed"
                    ? "Confirmed"
                    : userReservation?.status === "waiting"
                      ? "Waiting in Queue"
                      : full
                        ? "Join Waitlist"
                        : "Reserve Spot";

              return (
                <article
                  key={event.id}
                  className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                      Event
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        full
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {full ? "Full" : "Available"}
                    </span>
                  </div>

                  <h2 className="mt-5 text-lg font-bold text-slate-900">
                    {event.name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Event #{event.id}
                  </p>

                  <div className="mt-6">
                    <div className="flex justify-between gap-3 text-xs text-slate-500">
                      <span>
                        {event.confirmed_count}/{event.capacity} booked
                      </span>
                      <span
                        className={`font-semibold ${
                          full ? "text-amber-700" : "text-emerald-700"
                        }`}
                      >
                        {full
                          ? "Waitlist open"
                          : `${event.remaining_spots} spots left`}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${
                          full ? "bg-amber-500" : "bg-indigo-500"
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={reservingEventId !== null || alreadyReserved}
                    onClick={() => handleReserve(event)}
                    className={`mt-6 w-full rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      userReservation?.status === "confirmed"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : userReservation?.status === "waiting"
                          ? "border border-amber-200 bg-amber-50 text-amber-700"
                          : full
                            ? "border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                    }`}
                  >
                    {buttonLabel}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
