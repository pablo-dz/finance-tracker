import pg from "pg";
import { createDashboardServer } from "./server.js";

if (!process.env.DATABASE_URL && !process.env.PGDATABASE) {
  throw new Error("Configura DATABASE_URL o PGDATABASE antes de iniciar la aplicación.");
}

const pool = new pg.Pool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined,
);
const server = createDashboardServer(pool);

server.listen(3000, "127.0.0.1", () => {
  console.log("Dashboard disponible en http://127.0.0.1:3000");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
    });
  });
}
