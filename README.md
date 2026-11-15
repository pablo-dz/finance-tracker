# Finance tracker

Proyecto para entender ingresos, gastos y presupuestos en pesos chilenos (CLP). La primera etapa permite registrar gastos de una persona y verlos en una página web local. El esquema de PostgreSQL ya permite asociar varios integrantes a un mismo hogar, pero la autenticación y el acceso compartido todavía no están implementados.

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

## Dashboard y registro de gastos

Necesitas Node.js 22 o superior y npm. Con PostgreSQL iniciado y los datos de prueba cargados, ejecuta desde la raíz del proyecto:

```bash
npm install
PGDATABASE=finance_tracker FINANCE_HOUSEHOLD_ID=1 npm start
```

Reemplaza `finance_tracker` y `1` por el nombre de tu base y el ID de tu hogar personal. Puedes consultar los hogares con `psql -d finance_tracker -c "SELECT household_id, name FROM finance.household;"`. La aplicación requiere un hogar personal en CLP con exactamente un integrante activo, al menos una cuenta activa en CLP y categorías de gastos. No acepta el hogar de prueba como hogar personal.

Si tu hogar aún no tiene cuenta, consulta los IDs de sus integrantes y crea una cuenta para el integrante correspondiente. Por ejemplo, **sustituye ambos IDs** por los de tu base antes de ejecutar:

```sql
SELECT member_id, household_id, name FROM finance.member WHERE is_active;
INSERT INTO finance.account (household_id, member_id, name, type, currency)
VALUES (1, 1, 'Cuenta personal', 'checking', 'CLP');
```

La creación de esta cuenta se realiza una sola vez; la aplicación no la crea automáticamente. Ejecuta las consultas desde `psql` y verifica que el integrante pertenezca al hogar seleccionado.

También puedes configurar la conexión con `DATABASE_URL`, o con las variables de PostgreSQL `PGHOST`, `PGPORT`, `PGUSER` y `PGPASSWORD`. No guardes contraseñas en archivos versionados.

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). Si el puerto 3000 está ocupado, puedes indicar otro, por ejemplo `PORT=3001 PGDATABASE=finance_tracker FINANCE_HOUSEHOLD_ID=1 npm start`, y abrir `http://127.0.0.1:3001`. Selecciona la vista personal para registrar gastos reales en pesos enteros y consultar su total mensual y distribución por categoría. La vista de prueba permanece separada y es de solo lectura. Sin `FINANCE_HOUSEHOLD_ID` puedes consultar la demo, pero no registrar gastos. El formulario todavía no permite editar ni eliminar movimientos. Para detener el servidor, presiona `Ctrl+C`.

La aplicación es local y no tiene autenticación ni separación segura entre usuarios: cualquier persona con acceso al equipo puede usarla o acceder a la base. No la expongas a internet ni a redes compartidas. El servidor escucha únicamente en `127.0.0.1`. Respalda regularmente tu base de datos.

Para ejecutar las pruebas:

```bash
npm test
```

## Próximos pasos

En una siguiente etapa se pueden comparar gastos con presupuestos. Más adelante, el hogar compartido requerirá cuentas de usuario, autenticación y permisos; agregar integrantes a las tablas por sí solo no proporciona acceso seguro.

Trabaja en ramas de funcionalidad y abre un pull request hacia `main`.
