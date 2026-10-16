import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./config/db";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({
      status: "ok",
      database: "connected",
      time: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database connection error:", error);

    res.status(500).json({
      status: "error",
      database: "disconnected",
    });
  }
});

app.post("/events", async (req, res) => {
  try {
    const { name, capacity } = req.body;

    const result = await pool.query(
      `INSERT INTO events (name, capacity)
       VALUES ($1, $2)
       RETURNING *`,
      [name, capacity],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating event:", error);

    res.status(500).json({
      error: "Failed to create event",
    });
  }
});

app.get("/events", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM events ORDER BY created_at DESC",
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching events:", error);

    res.status(500).json({
      error: "Failed to fetch events",
    });
  }
});

app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("SELECT * FROM events WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Event not found",
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching event:", error);

    res.status(500).json({
      error: "Failed to fetch event",
    });
  }
});

app.post("/events/:id/reserve", async (req, res) => {
  const { user_id } = req.body;

  if (!Number.isInteger(user_id) || user_id <= 0) {
    return res.status(400).json({
      error: "user_id must be a positive integer",
    });
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Check whether the user exists here.
    const userResult = await client.query(
      "SELECT id FROM users WHERE id = $1",
      [user_id],
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "User not found",
      });
    }

    // reservation logic
    const { id } = req.params;

    const eventResult = await client.query(
      "SELECT * FROM events WHERE id = $1 FOR UPDATE",
      [id],
    );

    if (eventResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Event not found",
      });
    }

    const event = eventResult.rows[0];
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count
      FROM reservations
      WHERE event_id = $1
      AND status = 'confirmed'`,
      [id],
    );

    const confirmedCount = countResult.rows[0].count;
    const status = confirmedCount < event.capacity ? "confirmed" : "waiting";

    // save status for new reservation in postgress

    const reservationResult = await client.query(
      `INSERT INTO reservations (user_id, event_id, status)
       VALUES ($1, $2, $3)
        RETURNING *`,
      [user_id, id, status],
    );

    await client.query("COMMIT");

    return res.status(201).json(reservationResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return res.status(409).json({
        error: "You already have an active reservation for this event",
      });
    }

    console.error("Reservation error:", error);

    return res.status(500).json({
      error: "Failed to create reservation",
    });
  } finally {
    client.release();
  }
});

app.post("/reservations/:id/cancel", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { id } = req.params;

    // Find the reservation
    const reservationResult = await client.query(
      "SELECT * FROM reservations WHERE id=$1",
      [id],
    );

    if (reservationResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Reservation not found",
      });
    }

    const reservation = reservationResult.rows[0];

    // Lock the event
    const eventResult = await client.query(
      "SELECT id FROM events WHERE id = $1 FOR UPDATE",
      [reservation.event_id],
    );

    if (eventResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Event not found",
      });
    }

    // fetch the reservation a second time
    const currentReservationResult = await client.query(
      "SELECT * FROM reservations WHERE id = $1",
      [id],
    );

    const currentReservation = currentReservationResult.rows[0];

    if (currentReservation.status === "cancelled") {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Reservation is already cancelled",
      });
    }

    // Cancel the reservation
    const cancelResult = await client.query(
      `UPDATE reservations
       SET status = 'cancelled'
       WHERE id = $1
       RETURNING *`,
      [id],
    );

    // Decide whether to promote someone
    let promotedReservation = null;

    if (currentReservation.status === "confirmed") {
      const nextReservationResult = await client.query(
        `SELECT *
         FROM reservations
         WHERE event_id = $1
         AND status = 'waiting'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [currentReservation.event_id],
      );

      if (nextReservationResult.rows.length > 0) {
        const nextReservation = nextReservationResult.rows[0];

        const promotionResult = await client.query(
          `UPDATE reservations
            SET status = 'confirmed'
            WHERE id = $1
            RETURNING *`,
          [nextReservation.id],
        );

        promotedReservation = promotionResult.rows[0];
      }
    }

    // Commit and return the response
    await client.query("COMMIT");

    return res.status(200).json({
      message: "Reservation cancelled successfully",
      cancelledReservation: cancelResult.rows[0],
      promotedReservation,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Cancellation error:", error);

    return res.status(500).json({
      error: "Failed to cancel reservation",
    });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`server is running on ${PORT}`);
});
