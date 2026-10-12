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
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // reservation logic will go here
    const { id } = req.params;

    const eventResult = await client.query(
      "SELECT * FROM events WHERE id = $1",
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
    const { user_id } = req.body;

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
    console.error("Reservation error:", error);

    return res.status(500).json({
      error: "Failed to create reservation",
    });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`server is running on ${PORT}`);
});
