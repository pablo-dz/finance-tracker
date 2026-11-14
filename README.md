# Finance tracker

Proyecto para entender ingresos, gastos y presupuestos en pesos chilenos (CLP). El objetivo es tener un dashboard en una página web propia. La primera etapa considera una persona; el esquema de PostgreSQL ya permite asociar varios integrantes a un mismo hogar. La aplicación, la autenticación y el acceso compartido todavía no están implementados.

## Lo que existe

- `db/migrations/001_schema.sql`: tablas de hogares, integrantes, cuentas, categorías, movimientos, presupuestos y metas.
- `db/migrations/002_bi_views.sql`: vistas de consulta que podrán servir como base para el dashboard web. Se conserva el nombre original de la migración.
- `db/migrations/003_reference_data.sql`: hogar, integrante y categorías iniciales.
- `db/seeds/001_demo.sql`: datos **ficticios**, separados de los datos reales.

## Preparar una base nueva

Necesitas PostgreSQL y el cliente `psql`. Crea una base vacía usando el procedimiento de tu instalación y configura la conexión localmente; por ejemplo, define la variable de entorno `DATABASE_URL` con una URL de PostgreSQL. No incluyas contraseñas en archivos versionados.

En una base **nueva y vacía**, ejecuta las migraciones en orden desde la raíz del proyecto:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_bi_views.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/003_reference_data.sql
```

Las migraciones existentes no son repetibles: **no las vuelvas a ejecutar sobre una base ya preparada**. Si ya las ejecutaste, continúa con el siguiente paso. No hay un mecanismo automático que registre qué migraciones se aplicaron.

## Cargar datos de prueba

Conéctate a la base correcta y ejecuta:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/001_demo.sql
```

El script crea un hogar llamado `[DEMO] Hogar de prueba`, una persona y una cuenta ficticias, movimientos y presupuestos del mes actual y los dos anteriores, y una meta de ahorro. Los movimientos se crean solo hasta la fecha actual; por eso un mes recién comenzado puede tener pocos registros. Los valores son ejemplos, no recomendaciones financieras.

El hogar de prueba tiene categorías propias y no modifica las de tu hogar. Si el nombre ya existe, el script termina con error sin insertar nada: no lo ejecutes nuevamente para actualizar los datos. La meta es solo un objetivo; el esquema aún no registra aportes ni calcula su avance.

## Consultar los ejemplos

Entra con `psql "$DATABASE_URL"` y ejecuta:

```sql
-- Ingresos y gastos por mes del hogar de prueba, sin incluir transferencias.
SELECT date_trunc('month', t.tx_date)::date AS mes,
       SUM(t.amount) FILTER (WHERE t.type = 'income') AS ingresos,
       SUM(t.amount) FILTER (WHERE t.type = 'expense') AS gastos
FROM finance.transactions t
JOIN finance.household h ON h.household_id = t.household_id
WHERE h.name = '[DEMO] Hogar de prueba'
GROUP BY 1
ORDER BY 1 DESC;

-- Gastos del mes actual por categoría.
SELECT c.name AS categoria, SUM(t.amount) AS gastado
FROM finance.transactions t
JOIN finance.household h ON h.household_id = t.household_id
JOIN finance.category c ON c.category_id = t.category_id
WHERE h.name = '[DEMO] Hogar de prueba'
  AND t.type = 'expense'
  AND t.tx_date >= date_trunc('month', current_date)::date
  AND t.tx_date < (date_trunc('month', current_date) + interval '1 month')::date
GROUP BY c.name
ORDER BY gastado DESC;
```

Usa `\q` para salir de `psql`. La diferencia entre ingresos y gastos no equivale necesariamente al ahorro real: puede haber transferencias u otros movimientos no registrados.

## Próximos pasos

En una siguiente etapa se puede construir una página web para registrar movimientos y visualizar gastos y presupuestos. Un servidor deberá acceder a PostgreSQL sin exponer sus credenciales en el navegador. Más adelante, el hogar compartido requerirá cuentas de usuario, autenticación y permisos; agregar integrantes a las tablas por sí solo no proporciona acceso seguro.

Trabaja en ramas de funcionalidad y abre un pull request hacia `main`.
