const API_URL = import.meta.env.VITE_API_URL;

export interface Event {
  id: number;
  name: string;
  capacity: number;
  created_at: string;
  confirmed_count: number;
  remaining_spots: number;
}

export async function getEvents(): Promise<Event[]> {
  const response = await fetch(`${API_URL}/events`);

  if (!response.ok) {
    throw new Error("Failed to load events");
  }

  return response.json() as Promise<Event[]>;
}

export interface Reservation {
  id: number;
  user_id: number;
  event_id: number;
  status: "confirmed" | "waiting" | "cancelled";
  created_at: string;
}

export async function createReservation(
  eventId: number,
  userId: number,
): Promise<Reservation> {
  const response = await fetch(`${API_URL}/events/${eventId}/reserve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to create reservation");
  }

  return data as Reservation;
}

export interface UserReservation {
  reservation_id: number;
  user_id: number;
  event_id: number;
  status: "confirmed" | "waiting" | "cancelled";
  created_at: string;
  event_name: string;
  capacity: number;
}

export async function getUserReservations(
  userId: number,
): Promise<UserReservation[]> {
  const response = await fetch(`${API_URL}/users/${userId}/reservations`);

  if (!response.ok) {
    throw new Error("Failed to load your reservations");
  }

  return response.json() as Promise<UserReservation[]>;
}
