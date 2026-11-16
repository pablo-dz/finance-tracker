import pg from "pg";
import { createDashboardServer } from "./server.js";

if (!process.env.DATABASE_URL && !process.env.PGDATABASE) {
  throw new Error("Configura DATABASE_URL o PGDATABASE antes de iniciar la aplicación.");
}

const pool = new pg.Pool(
  process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined,
);
const port = process.env.PORT ?? "3000";
if (!/^[1-9]\d*$/.test(port) || Number(port) > 65535) {
  throw new Error("PORT debe ser un puerto entre 1 y 65535.");
}
const server = createDashboardServer(pool);

server.listen(Number(port), "127.0.0.1", () => {
  console.log(`Dashboard disponible en http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
    });
  });
}
