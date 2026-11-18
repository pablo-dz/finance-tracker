# Finance tracker

Proyecto para entender ingresos, gastos, transferencias, presupuestos y metas de ahorro en pesos chilenos (CLP). La aplicación permite registrar y revisar las finanzas personales en una página web local. La colaboración con otras personas queda para una etapa futura.

## Estructura del proyecto

- `backend/`: API y servidor del dashboard en Python.
- `frontend/`: interfaz web en HTML, CSS y JavaScript.
- `frontend/modules/`: módulos de autenticación, movimientos, planificación, ahorro y dashboard.
- `tests/backend/` y `tests/frontend/`: pruebas del backend y de la interfaz.
- `db/migrations/`: esquema y migraciones de PostgreSQL.
- `db/seeds/`: datos ficticios opcionales para pruebas manuales.

## Base de datos

- `db/migrations/001_schema.sql`: tablas de hogares, integrantes, cuentas, categorías, movimientos, presupuestos y metas.
- `db/migrations/002_bi_views.sql`: vistas de consulta que podrán servir como base para el dashboard web. Se conserva el nombre original de la migración.
- `db/migrations/003_reference_data.sql`: hogar, integrante y categorías iniciales.
- `db/migrations/004_account_balances_and_transfers.sql`: saldo inicial por cuenta y registro de transferencias.
- `db/migrations/005_savings_goal_contributions.sql`: registro de aportes y avance de metas de ahorro.
- `db/migrations/006_personal_category_archiving.sql`: permite archivar categorías sin borrar su historial.
- `db/migrations/007_user_accounts.sql`: cuentas locales, sesiones y asociación de perfiles personales a usuarios.
- `db/migrations/008_recurring_payments.sql`: pagos recurrentes personales registrados manualmente.
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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/007_user_accounts.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/008_recurring_payments.sql
```

Las migraciones existentes no son repetibles: **no las vuelvas a ejecutar sobre una base ya preparada**. Si tu base ya tiene la 007, aplica únicamente la 008 después de verificar la conexión y respaldar los datos. Si le faltan otras migraciones, aplica solo las pendientes en orden. La migración 007 no vincula los perfiles existentes a ninguna cuenta: los nuevos usuarios empiezan con un perfil personal nuevo. No hay un mecanismo automático que registre qué migraciones se aplicaron.

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

Necesitas Python 3.10 o superior, Node.js 22 o superior y npm. Con PostgreSQL iniciado y las migraciones aplicadas, prepara el entorno una sola vez desde la raíz del proyecto:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements-test.txt
npm install
```

Después inicia la aplicación con:

```bash
npm start
```

Por defecto, la aplicación se conecta a la base local `finance_tracker`. Para usar otra base, configura `PGDATABASE` antes de iniciar. Al abrir la página, crea una cuenta con tu correo y contraseña. La aplicación crea un perfil personal nuevo, una cuenta principal y categorías iniciales asociados a esa cuenta. Los perfiles y movimientos que ya existían antes de aplicar la migración 007 quedan sin asociar y no se muestran; no se copian ni se eliminan.

También puedes configurar la conexión con `DATABASE_URL`, o con las variables de PostgreSQL `PGHOST`, `PGPORT`, `PGUSER` y `PGPASSWORD`. No guardes contraseñas en archivos versionados.

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). Si el puerto 3000 está ocupado, puedes indicar otro con `PORT=3001 npm start` y abrir `http://127.0.0.1:3001`. En «Movimientos» puedes registrar ingresos y egresos y consultar su historial completo, ordenado por fecha, independientemente del mes del dashboard. Las transferencias se registran y muestran por separado: mueven saldo entre cuentas y no cuentan como ingreso ni gasto. Puedes editar y eliminar movimientos personales desde sus listas; la edición de gastos e ingresos solo admite pesos enteros, por lo que los registros existentes con centavos no se pueden editar. Las transferencias admiten centavos. Las eliminaciones son permanentes. En «Cuentas» puedes configurar el saldo inicial; se considera anterior a todos los movimientos guardados. Para detener el servidor, presiona `Ctrl+C`.

En «Movimientos» puedes combinar filtros de fecha, tipo, categoría, descripción y cuenta; las fechas incluyen ambos extremos. La búsqueda de descripción no distingue mayúsculas ni tildes. Los filtros también se aplican a las transferencias: la cuenta puede ser de origen o destino, y al seleccionar una categoría no aparecen porque no tienen categoría. Usa «Limpiar filtros» para volver a ver todo.

Al actualizar los módulos JavaScript, incrementa la versión `?v=` del módulo principal y de todas sus importaciones para evitar que el navegador mezcle versiones incompatibles.

El dashboard mensual compara ingresos, gastos, ahorro neto y tasa de ahorro con el mes anterior. Bajo el total de gastos muestra el desglose de gastos fijos y variables, y los sin clasificar cuando existen. El ahorro neto es ingresos menos gastos; no descuenta transferencias ni aportes a metas. Sin ingresos no se calcula la tasa. El gráfico de presupuestos compara el gasto con el límite de cada categoría en una escala común en CLP: verde si está dentro del límite y rojo si lo supera. Pasa el cursor, toca o enfoca una barra para ver sus importes y alertas desde el 80 %; las categorías sin presupuesto aparecen aparte. Incluye tendencias de 6 o 12 meses por categoría, mayores gastos y comercios, y una comparación del gasto acumulado con un ritmo uniforme basado únicamente en categorías presupuestadas; el gasto sin presupuesto se informa aparte.

El ritmo ideal distribuye uniformemente el presupuesto mensual entre los días del mes. Para el día $d$, con presupuesto total $P$ en pesos y $D$ días en el mes:

```math
\text{Ritmo ideal acumulado}(d) = \frac{\left\lfloor 100 \times P \times d / D \right\rfloor}{100}
```

$P$ es la suma de los límites configurados para ese mes. El resultado se trunca al centavo; el día 0 comienza en cero. Por ejemplo, con un presupuesto de $900.000 en un mes de 30 días, el ritmo ideal al día 10 es $300.000. El gráfico lo compara con los gastos acumulados de categorías con presupuesto; los demás gastos se indican por separado. Es una referencia uniforme, no una predicción ni una consideración de las fechas reales de los pagos.

Los gráficos de líneas muestran ingresos, gastos y ahorro, ritmo de gasto y evolución de saldos; el gráfico de composición muestra la distribución mensual por categoría. Los gráficos con ejes indican el período o categoría en el eje horizontal y el monto en CLP en el vertical, con una escala que se ajusta a los datos. En los gráficos de ingresos, gastos y ahorro y de ritmo de gasto, señala, toca o enfoca un punto para ver los valores del mes o día. En el gráfico de categorías, señala, toca o selecciona una porción o su leyenda para ver su evolución con el mismo color; interactúa con un punto de la evolución para ver el gasto del mes. Las categorías con gastos solo en meses anteriores también aparecen en la leyenda. El efecto de profundidad es visual y las proporciones corresponden a los importes del mes. Los gráficos de líneas se desplazan horizontalmente cuando no caben.

Puedes clasificar categorías como fijas o variables; su clasificación actual se aplica también al historial. Los pagos recurrentes se registran manualmente y no generan movimientos. Sus equivalentes mensuales de pagos anuales se redondean al centavo y son aproximados. La proyección de cada meta usa el promedio de aportes de los últimos tres meses calendario completos anteriores al mes actual; no predice una fecha si no hubo aportes.

La evolución de saldos suma las cuentas activas en CLP al cierre de cada mes o hasta hoy, incluyendo transferencias. El saldo inicial se considera anterior a todos los movimientos, incluso para meses anteriores a la creación de una cuenta. No es una medición completa del patrimonio: excluye cuentas inactivas, otras monedas y activos o deudas no registrados. Los saldos actuales individuales aparecen en «Cuentas».

En «Categorías», consulta un mes y escribe el presupuesto junto a cada categoría. El mes seleccionado también actualiza el dashboard. Guarda los presupuestos junto con las categorías mediante «Actualizar categorías»; deja un campo vacío para quitar ese presupuesto del mes. El límite se configura por separado para cada mes, en pesos enteros; también puede ser cero. Los presupuestos existentes con centavos se conservan si no se modifican. El gráfico del dashboard compara el gasto personal de ese mes en CLP con el límite y muestra lo disponible o excedido. No incluye ingresos, transferencias, gastos sin categoría ni gastos en otras monedas. Si otra operación modifica un presupuesto desde que se consultó, descarta los cambios y vuelve a consultar antes de guardarlo.

En «Categorías» puedes crear y renombrar categorías personales, clasificarlas como fijas o variables, y archivar o restaurar las que ya no uses. Los cambios se guardan juntos solo al pulsar «Actualizar categorías»; también puedes descartarlos y recargar. Las nuevas categorías son variables por defecto. Archivar no borra los gastos ni presupuestos anteriores; las categorías archivadas dejan de estar disponibles para nuevos gastos y presupuestos. Al renombrar o reclasificar una categoría, el cambio también aparece en sus registros anteriores.

También puedes crear metas de ahorro con un monto objetivo y una fecha opcional, y registrar aportes para consultar el avance y el historial. Los aportes son solo seguimiento de la meta: **no modifican saldos de cuentas ni registran gastos o transferencias**. Puedes eliminar un aporte si lo registraste por error.
Accede a estas funciones desde «Metas de ahorro» en la navegación; «Dashboard» vuelve al resumen financiero y «Movimientos» al registro e historial. La consulta de metas es independiente del mes seleccionado.

Las cuentas usan contraseñas derivadas con `scrypt` y sesiones locales con cookies `HttpOnly`. No hay verificación de correo ni recuperación de contraseña. El servidor escucha únicamente en `127.0.0.1`; no lo expongas a internet ni a redes compartidas. El usuario configurado para conectarse a PostgreSQL es una credencial técnica distinta de la cuenta con la que inicias sesión en la aplicación. Respalda regularmente tu base de datos.

Para ejecutar las pruebas:

```bash
npm test
```

## API Python

El backend y el servidor del dashboard usan Python; la interfaz sigue usando JavaScript en el navegador. La API utiliza por defecto la base local `finance_tracker`, o `DATABASE_URL` y las variables estándar de PostgreSQL para otra conexión. Conserva las cuentas y sesiones existentes. Escucha solo en el equipo local; no la expongas a internet ni a redes compartidas.

Las pruebas de integración con PostgreSQL se omiten por defecto. Para incluirlas junto con las pruebas de la interfaz, ejecuta `FINANCE_TEST_ADMIN_DATABASE=finance_tracker npm test`. Requieren permiso para crear bases: crean bases temporales separadas y las eliminan al terminar; no modifican la base indicada. Las pruebas también comprueban la compatibilidad con cuentas y sesiones creadas por el servidor anterior de Node.

## Próximos pasos

Más adelante, compartir un hogar entre varias cuentas requerirá invitaciones y permisos; esta primera etapa mantiene un perfil personal por usuario.

Trabaja en ramas de funcionalidad y abre un pull request hacia `main`.
