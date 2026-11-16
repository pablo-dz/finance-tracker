# Finance tracker

Proyecto para entender ingresos, gastos y presupuestos en pesos chilenos (CLP). La aplicación permite registrar y revisar las finanzas de una persona en una página web local. La colaboración con otras personas queda para una etapa futura.

## Lo que existe

- `db/migrations/001_schema.sql`: tablas de hogares, integrantes, cuentas, categorías, movimientos, presupuestos y metas.
- `db/migrations/002_bi_views.sql`: vistas de consulta que podrán servir como base para el dashboard web. Se conserva el nombre original de la migración.
- `db/migrations/003_reference_data.sql`: hogar, integrante y categorías iniciales.
- `db/migrations/006_personal_category_archiving.sql`: permite archivar categorías sin borrar su historial.
- `db/seeds/001_demo.sql`: datos **ficticios**, separados de los datos reales.

## Preparar una base nueva

Necesitas PostgreSQL y el cliente `psql`. Crea una base vacía usando el procedimiento de tu instalación y configura la conexión localmente; por ejemplo, define la variable de entorno `DATABASE_URL` con una URL de PostgreSQL. No incluyas contraseñas en archivos versionados.

En una base **nueva y vacía**, ejecuta las migraciones en orden desde la raíz del proyecto:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/002_bi_views.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/003_reference_data.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/006_personal_category_archiving.sql
```

Las migraciones existentes no son repetibles: **no las vuelvas a ejecutar sobre una base ya preparada**. Si ya aplicaste las migraciones 001–003, ejecuta solo la 006. Si también aplicaste las migraciones 004 y 005 de otras mejoras, ejecuta la 006 después de ellas. No hay un mecanismo automático que registre qué migraciones se aplicaron.

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

Reemplaza `finance_tracker` y `1` por el nombre de tu base y el ID de tu perfil. Puedes consultar los perfiles con `psql -d finance_tracker -c "SELECT household_id, name FROM finance.household;"`. El perfil debe usar CLP y tener una sola persona activa y categorías de gastos. Para registrar gastos también necesitas al menos una cuenta activa en CLP. La aplicación no usa el conjunto ficticio.

Si tu perfil aún no tiene una cuenta, consulta el ID de la persona y crea una cuenta asociada. Por ejemplo, **sustituye ambos IDs** por los de tu base antes de ejecutar:

```sql
SELECT member_id, household_id, name FROM finance.member WHERE is_active;
INSERT INTO finance.account (household_id, member_id, name, type, currency)
VALUES (1, 1, 'Cuenta personal', 'checking', 'CLP');
```

La creación de esta cuenta se realiza una sola vez; la aplicación no la crea automáticamente. Ejecuta las consultas desde `psql` y verifica que la persona pertenezca al perfil seleccionado.

También puedes configurar la conexión con `DATABASE_URL`, o con las variables de PostgreSQL `PGHOST`, `PGPORT`, `PGUSER` y `PGPASSWORD`. No guardes contraseñas en archivos versionados.

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). Si el puerto 3000 está ocupado, puedes indicar otro, por ejemplo `PORT=3001 PGDATABASE=finance_tracker FINANCE_HOUSEHOLD_ID=1 npm start`, y abrir `http://127.0.0.1:3001`. La página muestra tus gastos personales: consulta un mes, registra, edita y elimina gastos, y revisa el resumen, los presupuestos y las categorías. Para editar, usa el botón junto al movimiento y guarda los cambios o cancela; la edición solo admite pesos enteros. Para eliminar, usa el botón junto al gasto y confirma: la eliminación es permanente. Se requiere `FINANCE_HOUSEHOLD_ID` para abrir el perfil configurado; no hay una vista alternativa de prueba. Para detener el servidor, presiona `Ctrl+C`.

Consulta un mes y crea un presupuesto para cada categoría que quieras controlar. El límite se configura por separado para cada mes, en pesos enteros; también puede ser cero. Las categorías sin límite aparecen como «Sin presupuesto». La comparación muestra el gasto personal de ese mes en CLP, el límite y lo disponible o excedido, conservando los centavos de gastos existentes. No incluye ingresos, transferencias, gastos sin categoría ni gastos en otras monedas. Para cambiar un límite usa «Cambiar límite»; si otra operación lo cambió desde que se consultó, vuelve a consultar antes de editarlo.

En «Mis categorías» puedes crear y renombrar categorías personales, y archivar o restaurar las que ya no uses. Archivar no borra los gastos ni presupuestos anteriores; las categorías archivadas dejan de estar disponibles para nuevos gastos y presupuestos. Al renombrar una categoría, el nombre nuevo también aparece en sus registros anteriores.

La aplicación es local y no tiene autenticación ni separación segura entre usuarios: cualquier persona con acceso al equipo puede usarla o acceder a la base. No la expongas a internet ni a redes compartidas. El servidor escucha únicamente en `127.0.0.1`. Respalda regularmente tu base de datos.

Para ejecutar las pruebas:

```bash
npm test
```

## Próximos pasos

Más adelante, la colaboración con otras personas requerirá cuentas de usuario, autenticación y permisos; agregar integrantes a las tablas por sí solo no proporciona acceso seguro.

Trabaja en ramas de funcionalidad y abre un pull request hacia `main`.
