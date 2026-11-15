import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = {
  "/": ["./web/index.html", "text/html; charset=utf-8"],
  "/dashboard.js": ["./web/dashboard.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["./web/styles.css", "text/css; charset=utf-8"],
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

export function createDashboardServer(pool) {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end();
        return;
      }

      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/api/gastos") {
        const month = url.searchParams.get("mes");
        if (!month || !/^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(month) || url.searchParams.getAll("mes").length !== 1) {
          sendJson(response, 400, { error: "Selecciona un mes válido." });
          return;
        }

        const households = await pool.query(
          "SELECT household_id FROM finance.household WHERE name = $1",
          ["[DEMO] Hogar de prueba"],
        );
        if (households.rows.length !== 1) {
          sendJson(response, 409, { error: "Debe existir exactamente un hogar de prueba. Revisa la carga de datos ficticios." });
          return;
        }

        const result = await pool.query(
          `SELECT COALESCE(c.name, 'Sin categoría') AS category,
                  SUM(t.amount)::text AS total, COUNT(*)::int AS count,
                  (SUM(SUM(t.amount)) OVER ())::text AS grand_total
           FROM finance.transactions t
           LEFT JOIN finance.category c
             ON c.category_id = t.category_id AND c.household_id = t.household_id
           WHERE t.household_id = $1 AND t.type = 'expense'
             AND t.tx_date >= ($2 || '-01')::date
             AND t.tx_date < (($2 || '-01')::date + interval '1 month')
           GROUP BY c.category_id, c.name
           ORDER BY SUM(t.amount) DESC, c.name`,
          [households.rows[0].household_id, month],
        );
        sendJson(response, 200, { month, total: result.rows[0]?.grand_total ?? "0", categories: result.rows });
        return;
      }

      const file = files[url.pathname];
      if (!file) {
        response.writeHead(404);
        response.end("No encontrado");
        return;
      }
      const contents = await readFile(new URL(file[0], import.meta.url));
      response.writeHead(200, { "Content-Type": file[1] });
      response.end(contents);
    } catch (error) {
      console.error("Error al atender la solicitud:", error);
      if (!response.headersSent) sendJson(response, 500, { error: "No se pudieron cargar los datos. Revisa la conexión y el servidor." });
      else response.destroy();
    }
  });
}
