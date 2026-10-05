import { Client } from "pg";

const client = new Client({
  host: "127.0.0.1",
  port: 5432,
  user: "flowreserve",
  password: "flowreserve_password",
  database: "flowreserve",
});

async function test() {
  try {
    await client.connect();

    const result = await client.query("SELECT current_user, current_database()");

    console.log("CONNECTED!");
    console.log(result.rows);

    await client.end();
  } catch (error) {
    console.error("CONNECTION FAILED:");
    console.error(error);
  }
}

test();