# Triggers y dependencias — stock / compras / catálogo

REFERENCIA VERSIONADA — volcado de la base el 2026-11-04 — NO ES MIGRACIÓN, NO APLICAR

Proyecto Supabase `wpiwjpvjqshsgrxxwsld` (ConeOS), schema `public`. Cuerpos de las funciones citadas: `05-funciones-trigger-y-auth.sql` (verificados por md5 contra la base).

## 1. Triggers de las tablas pedidas (pg_trigger, no internos)

| Tabla | Trigger | Momento / eventos | Nivel | Función |
|---|---|---|---|---|
| producto_stock | bump_catalogo | AFTER INSERT OR DELETE OR UPDATE | ROW | trg_bump_catalogo() |
| presentaciones | bump_catalogo | AFTER INSERT OR DELETE OR UPDATE | ROW | trg_bump_catalogo() |
| productos | bump_catalogo | AFTER INSERT OR DELETE OR UPDATE | ROW | trg_bump_catalogo() |
| opciones | bump_catalogo | AFTER INSERT OR DELETE OR UPDATE | ROW | trg_bump_catalogo() |
| promociones | bump_catalogo | AFTER INSERT OR DELETE OR UPDATE | ROW | trg_bump_catalogo() |
| pedidos | pedidos_updated_at | BEFORE UPDATE | ROW | set_updated_at() |

Sin triggers: pedido_items, stock_movimientos, articulos, articulo_stock, articulo_presentaciones_compra, arqueos_stock, arqueo_items y todas las tablas de compras (proveedores, ordenes_compra*, remitos_compra*, comprobantes_compra*, cuenta_corriente_proveedor, ordenes_pago_*, chequeras, cheques). Todos los triggers están habilitados (tgenabled = O). Ninguno tiene cláusula WHEN ni `UPDATE OF columnas`: se disparan con cualquier UPDATE, aunque no cambie nada relevante.

`presentaciones.factor_stock` no tiene trigger propio: solo el CHECK `presentaciones_factor_stock_positivo` y el `bump_catalogo` genérico de la tabla.

Fuera del alcance pedido, pero con el mismo trigger `bump_catalogo` (trg_bump_catalogo): categorias, empresa_config, grupos_opciones, inventario_opciones, presentacion_grupos, promo_slots, promo_slot_presentaciones, sucursal_catalogo_config. Además `inventario_opciones.inventario_updated_at` (set_updated_at). `cron.job` tiene un trigger propio de pg_cron (ajeno).

## 2. Qué hace cada función

- `trg_bump_catalogo()` (sin SECURITY DEFINER): lee `sucursal_id` y `empresa_id` de la fila con `to_jsonb(coalesce(new, old))`. Si hay `sucursal_id` llama `bump_catalogo_sucursal(suc, emp)`; si no, y hay `empresa_id`, llama `bump_catalogo_empresa(emp)`; si no hay ninguna de las dos no hace nada (caso `presentacion_grupos`: no bumpea nunca).
- `bump_catalogo_sucursal(suc, emp)` (SECURITY DEFINER): upsert de UNA fila en `catalogo_version` (PK sucursal_id), `version = version + 1`.
- `bump_catalogo_empresa(emp)` (SECURITY DEFINER): UPDATE de TODAS las filas de `catalogo_version` de la empresa (`version + 1`), y luego un INSERT ... ON CONFLICT DO NOTHING que siembra sucursales sin fila.
- `set_updated_at()`: `new.updated_at = now()`. Sin efectos laterales.

`catalogo_version` (hoy 7 filas): `sucursal_id` PK (FK a sucursales ON DELETE CASCADE), `empresa_id`, `version bigint default 1`, `updated_at`. Sin triggers propios. Policy `catalogo_version_read` SELECT true.

## 3. Qué bumpea cada tabla

| Tabla origen | Tiene sucursal_id | Efecto sobre catalogo_version |
|---|---|---|
| producto_stock | sí | 1 fila (la de esa sucursal), por cada fila INSERT/UPDATE/DELETE |
| presentaciones, productos, opciones, promociones | no (solo empresa_id) | TODAS las sucursales de la empresa, por cada fila afectada |
| pedidos | — | ninguno (solo updated_at) |
| pedido_items, articulo_stock, stock_movimientos, tablas de compras | — | ninguno |

Consecuencia útil: el stock de insumos (`articulo_stock`) y los movimientos NO invalidan el catálogo; el stock de la ficha de venta (`producto_stock`) sí, en cada venta/ajuste/arqueo/ingreso de compra vinculado a un producto.

## 4. Riesgos de locks y deadlocks (marcados)

**[ALTO] Fila caliente en catalogo_version.** El bump es AFTER ROW y el lock de fila de `catalogo_version` se mantiene hasta el COMMIT de la transacción que tocó `producto_stock`. Toda transacción que modifique stock de una misma sucursal se serializa en esa fila, aun cuando toque productos distintos. Es por diseño aceptable con poco tráfico, pero cualquier transacción larga que toque `producto_stock` bloquea a todas las demás ventas de la sucursal.

**[ALTO] Editar presentaciones / productos / opciones / promociones bloquea a toda la empresa.** `bump_catalogo_empresa` actualiza todas las filas de `catalogo_version` de la empresa. Mientras esa transacción esté abierta (p. ej. una carga masiva de `factor_stock`), cualquier venta o ajuste de stock de cualquier sucursal de la empresa espera, y viceversa: si una venta ya tiene tomada la fila de su sucursal, el UPDATE de presentaciones espera a que termine.

**[ALTO] Riesgo de deadlock por orden de locks.** (a) Una transacción que toque `producto_stock` de dos sucursales en órdenes opuestos, o que combine UPDATE de `presentaciones`/`productos` con UPDATE de `producto_stock` (la primera toma filas de catalogo_version "de a una por sucursal" y la segunda "todas"), puede formar ciclo sobre las filas de `catalogo_version`. (b) Dos `bump_catalogo_empresa` concurrentes recorren las mismas filas sin ORDER BY; como cada UPDATE crea una versión nueva de la fila, el orden físico puede cambiar y no hay garantía de orden estable.

**[MEDIO] Amplificación por fila.** El trigger es FOR EACH ROW: un UPDATE masivo de N filas de `presentaciones`/`productos` ejecuta N veces el bump, y cada vez actualiza todas las sucursales (N x sucursales versiones de fila en una tabla de 7 filas): bloat y trabajo inútil dentro de la transacción. Conviene agrupar o bumpear una sola vez por sentencia (no se cambia nada acá: es solo referencia).

**[MEDIO] Ingreso de compra sin orden de lock.** `_ingresar_compra_stock` recorre las líneas en el orden del JSON y hace upsert / UPDATE sobre `producto_stock` o `articulo_stock` sin ORDER BY. Dos recepciones concurrentes en la misma sucursal con artículos en común y orden distinto pueden entrar en deadlock. `crear_pedido_stock` (excluida del volcado) sí ordena `order by pr.id` y toma antes un advisory lock `hashtext(sucursal || fecha)`, por lo que las ventas entre sí se serializan por sucursal-día; el riesgo cruzado es ingreso de compra vs. venta/arqueo sobre los mismos productos. `confirmar_arqueo_stock` ordena por `producto_id` y bloquea `arqueos_stock` -> `arqueo_items` -> `producto_stock`.

**[BAJO] FK pedido_items -> presentaciones (NO ACTION).** Insertar un `pedido_items` toma FOR KEY SHARE sobre la presentación; un UPDATE de `factor_stock` (columna no clave) toma FOR NO KEY UPDATE, que es compatible: no se bloquean entre sí. Un DELETE de la presentación sí falla o espera. Borrar un `productos` cascadea a `presentaciones` (ON DELETE CASCADE) y dispara un bump por cada presentación borrada.

**[BAJO] Advisory locks por empresa.** `crear_orden_compra` ('oc_'), `crear_remito_borrador` ('remito_') y `registrar_orden_pago` ('op_') usan `pg_advisory_xact_lock(hashtext(prefijo || empresa_id))`: serializan la numeración por empresa dentro de la transacción. Comparten el espacio de claves int4 con cualquier otro advisory lock (colisión improbable).

**[BAJO] Pagos.** `registrar_orden_pago` toma `chequeras FOR UPDATE` y `ordenes_pago_proveedor` (origen de crédito) `FOR UPDATE`; `anular_orden_pago` actualiza la OP y luego cheques/CC/comprobantes. Concurrencia sobre la misma OP origen se serializa por esa fila; no se vio ciclo evidente.

## 5. Hallazgos de seguridad relevados de paso (no son locks)

- `arqueos_stock` y `arqueo_items`: policies `USING (true) WITH CHECK (true)` para el rol `public` y GRANT de tabla a anon/authenticated (has_table_privilege = true para SELECT/UPDATE): un cliente con la anon key podría leer/escribir arqueos de cualquier empresa. `arqueo_items` ni siquiera tiene empresa_id.
- `stock_movimientos` y `producto_stock`/`catalogo_version` también tienen GRANT de tabla a anon; `stock_movimientos` está protegida solo porque no tiene policies (RLS sin policy deniega).
- `bump_catalogo_empresa(uuid)` y `bump_catalogo_sucursal(uuid, uuid)` son SECURITY DEFINER y ejecutables por `authenticated`: cualquier usuario logueado puede invocarlas con cualquier empresa/sucursal (invalidación de caché ajena, y toma de locks sobre filas ajenas).
- `ajustar_stock` y `confirmar_arqueo_stock` son ejecutables por `authenticated`; la autorización interna solo se evalúa cuando `session_user = 'authenticator'` (camino PostgREST).
- `pendiente_comprobante` y `recalcular_estado_comprobante` (sin SECURITY DEFINER, ACL por defecto) son ejecutables por PUBLIC/anon; respetan RLS de quien llama.
