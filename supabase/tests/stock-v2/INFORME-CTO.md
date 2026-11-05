# Stock V2 factor: informe de resultados para el CTO

4/11/2026 · rama `feature/stock-v2-factor` · Juan Cruz / Fable

**Estado:** desarrollo terminado y probado en un entorno aislado. No se aplicó nada en Supabase, no hubo merge a `main` ni deploy. Se espera el GO del CTO para aplicar.

## 1. Resultado en cinco líneas

1. `crear_pedido_stock` v1.6 descuenta `cantidad × factor_stock` y guarda el factor aplicado en `pedido_items.factor_stock_snap`, en la misma transacción.
2. La devolución de `/api/pedidos/eliminar` usa solo ese snapshot. Snapshot NULL equivale a factor 1. Mantiene el flip atómico que evita devolver dos veces.
3. El admin de catálogo tiene el campo "Consume del stock" (entero desde 1), visible solo si el producto controla stock.
4. Matriz de aceptación: 24 de 24 pruebas pasan con la v1.6. La RPC viva, usada como control, pasa 9 de 20 y falla justo donde tiene que fallar.
5. Hallazgo preexistente, ajeno a V2: un escritor de stock que toma los productos en orden inverso al de la venta puede provocar un deadlock por el trigger `bump_catalogo` (sección 5).

## 2. Qué se entrega

| Archivo | Para qué |
| --- | --- |
| `supabase/versionado/crear_pedido_stock.vivo-2026-11-04.sql` | Definición viva volcada de la base. Base real del diseño |
| `supabase/rpc-crear-pedido-stock-v2-factor.sql` | RPC v1.6 (el "v1.5" del GO) |
| `supabase/stock-v2-factor-migracion.sql` | Dos CHECK de entero ≥ 1, en dos pasos para no tomar locks largos |
| `supabase/stock-v2-factor-REVERSION.sql` | Devuelve la función a como estaba y quita los CHECK |
| `src/lib/stock/devolucion.ts` | Cálculo de unidades a devolver (función pura, probada en Node) |
| `src/app/api/pedidos/eliminar/route.ts` | Usa el helper y lee `factor_stock_snap` |
| `src/app/[empresa]/admin/catalogo/page.tsx` | Campo "Consume del stock" |
| `supabase/versionado/01…05` | SQL de Compras, artículos y Stock V2 volcado de la base (ver sección 7) |
| `supabase/tests/stock-v2/` | Matriz, esquema reducido, README y evidencia de las dos corridas |

## 3. Auditoría de la RPC viva

- **La viva no es el v1.4 del repo.** Ya incluye el bloque de promos (rotulado "v1.5" por dentro) y el precio server-authoritative. El repo estaba desactualizado, así que el diseño parte de la viva. Por eso internamente esta versión se llama v1.6.
- Es `SECURITY DEFINER` con `search_path = public`. Permisos de ejecución: `postgres` y `service_role`, no `anon`.
- Antes del advisory lock valida todo (sucursal, presentaciones, promos, precios, opciones): un rechazo no consume número, stock ni deja rastro.
- El descuento recorre los productos ordenados por `producto_id` y cada UPDATE exige `cantidad >= q`. Si falla, `SIN_STOCK` y rollback total.

## 4. Cambios de la v1.6 (todo lo demás es idéntico a la viva)

1. Un mapa `v_factores` con **una sola lectura** de `presentaciones.factor_stock` para todo el carrito. El mismo mapa alimenta el descuento y el snapshot, de modo que un cambio de factor a mitad de la transacción no puede separar lo descontado de lo grabado (prueba C3).
2. Validación `FACTOR_STOCK_INVALIDO` si el factor no es entero ≥ 1.
3. Descuento = Σ `cantidad × factor` por producto, en el mismo loop y con el mismo orden.
4. `factor_stock_snap` se graba en el mismo INSERT de `pedido_items`, para todo ítem con presentación. Los accesorios quedan en NULL.

**Decisión de tipo.** La columna `factor_stock` es `numeric` en la base. Para cumplir "entero ≥ 1" sin cambiar el tipo (evita reescribir la tabla y revisar dependencias) se agregan dos CHECK. Hoy las 198 presentaciones valen 1 y ningún ítem tiene snapshot, así que la validación es inmediata.

## 5. Locks, `bump_catalogo` y deadlocks

- La venta toma, en este orden: advisory lock por sucursal y día, luego las filas de `producto_stock` por `producto_id`, y cada UPDATE dispara `trg_bump_catalogo`, que toma la fila de `catalogo_version` de la sucursal hasta el commit.
- **Venta contra venta:** segura. El advisory lock las serializa (12 ventas simultáneas, sin errores, números 1 a 12).
- **Venta contra cambio de factor del admin:** sin deadlock en 180 ventas con el factor oscilando entre 8 y 10. El trigger de `presentaciones` actualiza todas las filas de `catalogo_version` de la empresa, pero la venta solo espera la suya.
- **Hallazgo preexistente (misma conducta con la RPC viva):** si otro escritor toma los productos en orden inverso al de la venta, hay un ciclo (el escritor retiene la fila de `catalogo_version` y pide el producto que la venta ya tiene). Postgres aborta una de las dos con `40P01`. En la prueba abortó la venta.
  - `ajustar_stock` toma un producto por vez, y `confirmar_arqueo_stock` ordena por `producto_id`: no producen el ciclo solos.
  - `_ingresar_compra_stock` (Compras) recorre las líneas en el orden en que llegan, sin ordenar. Un remito con varios productos puede cruzarse con una venta que toque los mismos.
  - **Recomendación, fuera del alcance de esta rama** (el GO pide no tocar Compras): ordenar las líneas por `producto_id` en `_ingresar_compra_stock`. Con el mismo orden la prueba C2a no da deadlock.

## 6. Matriz de aceptación

Entorno: Postgres 16 local, sin red, una base nueva por corrida y un mundo de datos nuevo por prueba. Salidas completas en `supabase/tests/stock-v2/`.

| Caso del GO | Resultado v1.6 | Qué se verificó |
| --- | --- | --- |
| Presentación x8 y porción x1 | Pasa | Caja x8 ×2 y porción ×3 descuentan 19 (100 a 81); snapshot 8 |
| Pedido mixto | Pasa | Porción ×2 + caja x8 + lata ×3: Alfajor −10, Bebida −3, un movimiento por producto |
| Caja x20 sin stock suficiente | Pasa | Con stock 15: `SIN_STOCK`, sin pedido, sin movimiento, stock 15, el número no se consume |
| Test histórico del CTO | Pasa | Vender con 8, cambiar a 10, eliminar: vuelven 8. Control negativo: con el factor vigente volverían 10 |
| Eliminación repetida | Pasa | Una sola devolución |
| Pedido anterior a V2 (snapshot NULL) | Pasa | 4 porciones devuelven 4; con factor vigente 10 devuelve 1 |
| Promociones con componentes | Pasa | Caja x8 + lata: 8 y 1, exactamente dos movimientos |
| Pedidos de mesa | Pasa | Mesa 5 descuenta 9 y el libro dice "Mesa 5" |
| Carrito viejo contra stock agotado | Pasa | `SIN_STOCK` (la API lo devuelve como 409), sin efectos |
| Dos ventas simultáneas del último stock | Pasa | Con stock 8 y dos cajas x8: pasa una, la otra `SIN_STOCK` |
| Conciliación del libro | Pasa | Stock inicial + Σ movimientos = stock actual; unidades de pedidos vivos = descuento neto |
| Rollback | Pasa | Una falla al insertar el ítem deshace stock, movimiento y pedido |
| Factor fuera de regla | Pasa | La base rechaza 2,5 y 0; si se colara, la RPC aborta con `FACTOR_STOCK_INVALIDO` |
| Concurrencia | Pasa | 12 ventas mezcladas; 180 ventas con el factor cambiando; deadlock del orden inverso reproducido (sección 5) |

Además, el helper de devolución en Node: 7 de 7 casos.

## 7. SQL de Compras, artículos y Stock V2 versionado

Volcado de solo lectura de la base el 4/11/2026 en `supabase/versionado/`, sin DDL ni DML:

| Archivo | Contenido |
| --- | --- |
| `01-stock-v1-v2-ddl.sql` | 7 tablas de stock y artículos, más las 4 columnas ajenas (`factor_stock`, `factor_stock_snap`, `stock_descontado`, `controla_stock`) |
| `02-compras-ddl.sql` | 14 tablas de Compras y pagos (incluye cheques y chequeras) y la vista `v_saldo_proveedor` |
| `03-stock-compras-functions.sql` | 18 funciones con sus permisos de ejecución |
| `04-triggers-y-dependencias.md` | Triggers, qué filas bloquea cada uno y riesgos de locks |
| `05-funciones-trigger-y-auth.sql` | `trg_bump_catalogo`, `bump_catalogo_*`, `set_updated_at`, `auth_rol` y `auth_empresa_id` |

**Verificación:** las 24 funciones coinciden con la base por md5 (`md5(pg_get_functiondef)` sin los `\r`). La verificación la hizo el agente que volcó los archivos y yo la repetí por separado: los 24 hashes son idénticos. En el DDL, las 21 tablas tienen el mismo número de columnas que `information_schema`. Quedan fuera `catalogo_version` (descrita en el 04) y las tablas de pagos de pedidos.

**Hallazgos de paso, fuera del alcance de V2 y para decisión del CTO:**

- `arqueos_stock` y `arqueo_items` tienen policies `USING (true)` para `public` y permisos para `anon`. Con la anon key se podrían leer y escribir arqueos de todas las empresas. `arqueo_items` ni siquiera tiene `empresa_id`.
- `bump_catalogo_empresa` y `bump_catalogo_sucursal` son `SECURITY DEFINER` y las puede ejecutar `authenticated` con cualquier empresa.
- `ajustar_stock` y `confirmar_arqueo_stock` validan la empresa solo cuando `session_user = 'authenticator'`.
- **Operativo:** editar `presentaciones`, `productos`, `opciones` o `promociones` toma todas las filas de `catalogo_version` de la empresa hasta el commit. Un cambio masivo de factores bloquearía las ventas de todas sus sucursales mientras dure.

## 8. Límites de la evidencia

- Es un Postgres local con esquema reducido (sin RLS, sin PostgREST, sin los FKs hacia Compras), no una copia de Supabase. Las funciones y constraints probados son los vivos del 4/11.
- La ruta HTTP de eliminar y la pantalla del admin no se probaron de punta a punta: solo typecheck, el helper en Node y la misma secuencia de SQL. El typecheck del repo ya tenía cientos de errores de tipo `never` por el cliente sin tipar; no aparecieron errores nuevos de otra clase en los archivos tocados.
- La concurrencia es de una sola máquina. No se midió carga real.
- **UX pendiente de decisión:** si una caja necesita 8 y quedan 5, la presentación sigue visible en el kiosco y falla recién al confirmar (409). Ocultarla o marcarla agotada toca `catalogo/route.ts` y los kioscos.
- **Preexistente en V1, sin cambios:** en `eliminar`, el flag `stock_descontado` se baja antes de devolver. Si `ajustar_stock` fallara a mitad, esa devolución no se reintenta.
- El admin guarda `presentaciones` desde el cliente (como hoy), no desde el servidor.

## 9. Cómo aplicarlo cuando haya GO

1. En el SQL Editor de Supabase: `stock-v2-factor-migracion.sql`.
2. Luego `rpc-crear-pedido-stock-v2-factor.sql`.
3. Recién después, merge a `main` y deploy. El campo "Consume del stock" solo debe existir con la RPC nueva ya aplicada.
4. Verificar con una venta de prueba en una sucursal de laboratorio: `factor_stock_snap` cargado y el libro cerrado.
5. Reversión: `stock-v2-factor-REVERSION.sql`. Antes de revertir, revisar si ya se cargaron factores distintos de 1.

**Riesgo a tener presente:** la base la comparten el laboratorio y producción. Cualquier cambio en la RPC rige para todos al instante.

## 10. GO que se pide

- [ ] Aplicar la migración y la RPC v1.6 en Supabase.
- [ ] Merge de `feature/stock-v2-factor` a `main` con `--no-ff`.
- [ ] Decisión sobre ordenar las líneas de Compras (sección 5) y sobre la visibilidad de presentaciones sin stock suficiente (sección 8).
