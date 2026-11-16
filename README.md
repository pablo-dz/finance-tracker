# Finance tracker

Proyecto para entender ingresos, gastos, transferencias, presupuestos y metas de ahorro en pesos chilenos (CLP). La aplicación permite registrar y revisar las finanzas personales en una página web local. La colaboración con otras personas queda para una etapa futura.

## Lo que existe

- `db/migrations/001_schema.sql`: tablas de hogares, integrantes, cuentas, categorías, movimientos, presupuestos y metas.
- `db/migrations/002_bi_views.sql`: vistas de consulta que podrán servir como base para el dashboard web. Se conserva el nombre original de la migración.
- `db/migrations/003_reference_data.sql`: hogar, integrante y categorías iniciales.
- `db/migrations/004_account_balances_and_transfers.sql`: saldo inicial por cuenta y registro de transferencias.
- `db/migrations/005_savings_goal_contributions.sql`: registro de aportes y avance de metas de ahorro.
- `db/migrations/006_personal_category_archiving.sql`: permite archivar categorías sin borrar su historial.
- `db/seeds/001_demo.sql`: datos **ficticios**, separados de los datos reales.

## Preparar una base nueva

Necesitas PostgreSQL y el cliente `psql`. Crea una base vacía usando el procedimiento de tu instalación y configura la conexión localmente; por ejemplo, define la variable de entorno `DATABASE_URL` con una URL de PostgreSQL. No incluyas contraseñas en archivos versionados.

En una base **nueva y vacía**, ejecuta las migraciones en orden desde la raíz del proyecto:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_bi_views.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/003_reference_data.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/004_account_balances_and_transfers.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/005_savings_goal_contributions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/006_personal_category_archiving.sql
```

Las migraciones existentes no son repetibles: **no las vuelvas a ejecutar sobre una base ya preparada**. Si ya aplicaste las migraciones 001–003, ejecuta la 004, 005 y 006 en ese orden. Si ya aplicaste la 004, ejecuta solo la 005 y la 006; si ya aplicaste la 005, ejecuta solo la 006. No hay un mecanismo automático que registre qué migraciones se aplicaron.

## Datos ficticios para pruebas manuales (opcional)

Conéctate a la base correcta y ejecuta:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/001_demo.sql
```

El script carga un conjunto separado de datos ficticios con movimientos y presupuestos. No necesitas cargarlo para usar el tracker: la aplicación muestra únicamente el perfil personal configurado y no tiene una vista de datos de prueba.

Si el conjunto ficticio ya existe, el script termina con error sin insertar nada; no lo ejecutes nuevamente para actualizar los datos.

## Inspeccionar los datos ficticios

Entra con `psql "$DATABASE_URL"` y ejecuta:

```sql
-- Ingresos y gastos por mes del conjunto ficticio, sin incluir transferencias.
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

## Dashboard personal

Necesitas Node.js 22 o superior y npm. Con PostgreSQL iniciado y tu perfil personal configurado, ejecuta desde la raíz del proyecto:

```bash
npm install
PGDATABASE=finance_tracker FINANCE_HOUSEHOLD_ID=1 npm start
```

Reemplaza `finance_tracker` y `1` por el nombre de tu base y el ID de tu perfil personal. Puedes consultar los perfiles con `psql -d finance_tracker -c "SELECT household_id, name FROM finance.household;"`. El perfil debe usar CLP y tener una sola persona activa, categorías de gastos e ingresos y al menos una cuenta activa en CLP. Para transferir entre cuentas necesitas dos cuentas activas. La aplicación no usa el conjunto ficticio.

Si tu perfil aún no tiene una cuenta, consulta el ID de la persona y crea una cuenta asociada. Por ejemplo, **sustituye ambos IDs** por los de tu base antes de ejecutar:

```sql
SELECT member_id, household_id, name FROM finance.member WHERE is_active;
INSERT INTO finance.account (household_id, member_id, name, type, currency)
VALUES (1, 1, 'Cuenta personal', 'checking', 'CLP');
```

La creación de esta cuenta se realiza una sola vez; la aplicación no la crea automáticamente. Ejecuta las consultas desde `psql` y verifica que la persona pertenezca al perfil seleccionado.

También puedes configurar la conexión con `DATABASE_URL`, o con las variables de PostgreSQL `PGHOST`, `PGPORT`, `PGUSER` y `PGPASSWORD`. No guardes contraseñas en archivos versionados.

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). Si el puerto 3000 está ocupado, puedes indicar otro, por ejemplo `PORT=3001 PGDATABASE=finance_tracker FINANCE_HOUSEHOLD_ID=1 npm start`, y abrir `http://127.0.0.1:3001`. La página muestra tus finanzas personales: consulta un mes, registra, edita y elimina gastos, registra ingresos y transferencias, consulta saldos y movimientos, y administra presupuestos, metas de ahorro y categorías. Para editar un gasto usa el botón junto al movimiento; la edición solo admite pesos enteros. Para eliminarlo, confirma la eliminación permanente. Para corregir un ingreso o transferencia, elimínalo y vuelve a registrarlo. Las transferencias mueven saldo entre cuentas y no cuentan como ingreso ni gasto. En «Cuentas» puedes configurar el saldo inicial de cada cuenta; el saldo actual suma ese punto de partida, los ingresos, resta los gastos y aplica las transferencias registradas hasta hoy. El saldo inicial se entiende como anterior a todos los movimientos guardados. La aplicación requiere `FINANCE_HOUSEHOLD_ID` para abrir el perfil configurado y no tiene una vista alternativa de prueba. Para detener el servidor, presiona `Ctrl+C`.

El reporte «Evolución de tus gastos» compara los últimos 3, 6 o 12 meses hasta el mes seleccionado. Muestra el total y promedio mensual, la evolución por mes y el gasto acumulado por categoría. Los meses sin movimientos aparecen con total cero. El reporte incluye únicamente gastos personales de cuentas en CLP.

Consulta un mes y crea un presupuesto para cada categoría que quieras controlar. El límite se configura por separado para cada mes, en pesos enteros; también puede ser cero. Las categorías sin límite aparecen como «Sin presupuesto». La comparación muestra el gasto personal de ese mes en CLP, el límite y lo disponible o excedido, conservando los centavos de gastos existentes. No incluye ingresos, transferencias, gastos sin categoría ni gastos en otras monedas. Para cambiar un límite usa «Cambiar límite»; si otra operación lo cambió desde que se consultó, vuelve a consultar antes de editarlo.

En «Mis categorías» puedes crear y renombrar categorías personales, y archivar o restaurar las que ya no uses. Archivar no borra los gastos ni presupuestos anteriores; las categorías archivadas dejan de estar disponibles para nuevos gastos y presupuestos. Al renombrar una categoría, el nombre nuevo también aparece en sus registros anteriores.

También puedes crear metas de ahorro con un monto objetivo y una fecha opcional, y registrar aportes para consultar el avance y el historial. Los aportes son solo seguimiento de la meta: **no modifican saldos de cuentas ni registran gastos o transferencias**. Puedes eliminar un aporte si lo registraste por error.

La aplicación es local y no tiene autenticación ni separación segura entre usuarios: cualquier persona con acceso al equipo puede usarla o acceder a la base. No la expongas a internet ni a redes compartidas. El servidor escucha únicamente en `127.0.0.1`. Respalda regularmente tu base de datos.

Para ejecutar las pruebas:

```bash
npm test
```

## Próximos pasos

Más adelante, la colaboración con otras personas requerirá cuentas de usuario, autenticación y permisos; agregar integrantes a las tablas por sí solo no proporciona acceso seguro.

Trabaja en ramas de funcionalidad y abre un pull request hacia `main`.
