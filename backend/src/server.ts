import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import pool from "./config/db";
import type { PoolClient } from "pg";
import argon2 from "argon2";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // validate req field
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "Name, email and password are required" });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    //Validate name
    if (normalizedName.length < 2 || normalizedName.length > 50) {
      return res.status(400).json({
        error: "Name must contain between 2 and 50 characters",
      });
    }

    //Validate email
    if (
      normalizedEmail.length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      return res.status(400).json({
        error: "Please provide a valid email address",
      });
    }

    // Validate password
    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({
        error: "Password must contain between 12 and 128 characters",
      });
    }

    // Check  email  exists
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail],
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: "An account with this email already exists",
      });
    }

    // hash pass using argon2id
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    // Insert user into PostgreSQL
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [normalizedName, normalizedEmail, passwordHash],
    );
    return res.status(201).json({
      message: "Account created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return res.status(409).json({
        error: "An account with this email already exists",
      });
    }
    console.error("Registration error:", error);

    return res.status(500).json({
      error: "Failed to register user",
    });
  }
});

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
      `SELECT
         e.id,
         e.name,
         e.capacity,
         e.created_at,
         COUNT(r.id) FILTER (
           WHERE r.status = 'confirmed'
         )::int AS confirmed_count,
         GREATEST(
           e.capacity - COUNT(r.id) FILTER (
             WHERE r.status = 'confirmed'
           ),
           0
         )::int AS remaining_spots
       FROM events e
       LEFT JOIN reservations r ON r.event_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC`,
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

  const eventId = Number(req.params.id);

  if (!Number.isInteger(eventId) || eventId <= 0) {
    return res.status(400).json({
      error: "Event ID must be a positive integer",
    });
  }

  if (!Number.isInteger(user_id) || user_id <= 0) {
    return res.status(400).json({
      error: "user_id must be a positive integer",
    });
  }
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
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

    const eventResult = await client.query(
      "SELECT * FROM events WHERE id = $1 FOR UPDATE",
      [eventId],
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
      [eventId],
    );

    const confirmedCount = countResult.rows[0].count;
    const status = confirmedCount < event.capacity ? "confirmed" : "waiting";

    // save status for new reservation in postgress

    const reservationResult = await client.query(
      `INSERT INTO reservations (user_id, event_id, status)
       VALUES ($1, $2, $3)
        RETURNING *`,
      [user_id, eventId, status],
    );

    await client.query("COMMIT");

    return res.status(201).json(reservationResult.rows[0]);
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

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
    client?.release();
  }
});

app.post("/reservations/:id/cancel", async (req, res) => {
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
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
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

    console.error("Cancellation error:", error);

    return res.status(500).json({
      error: "Failed to cancel reservation",
    });
  } finally {
    client?.release();
  }
});

app.get("/users/:id/reservations", async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({
      error: "User ID must be a positive integer",
    });
  }

  try {
    const userResult = await pool.query("SELECT id FROM users WHERE id = $1", [
      userId,
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const result = await pool.query(
      `SELECT
         r.id AS reservation_id,
         r.user_id,
         r.event_id,
         r.status,
         r.created_at,
         e.name AS event_name,
         e.capacity
       FROM reservations r
       JOIN events e ON e.id = r.event_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC, r.id DESC`,
      [userId],
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("Error fetching user reservations:", error);

    return res.status(500).json({
      error: "Failed to fetch user reservations",
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`server is running on ${PORT}`);
});
