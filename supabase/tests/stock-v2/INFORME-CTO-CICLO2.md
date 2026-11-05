# Stock V2, ciclo 2: respuesta a la orden del CTO (post auditoría 4/11)

4/11/2026 · Juan Cruz / Fable

**Estado:** puntos 1 a 4 desarrollados y probados en un entorno aislado. Punto 5 (validación integral con RLS y PostgREST reales) **preparado pero no ejecutado**: necesita el esquema real. No se ejecutó SQL en el Supabase compartido, no hubo merge a `main` ni deploy.

## 1. Lo importante, en seis líneas

1. **Corrijo mi informe anterior.** Dije que ordenar las líneas de Compras por `producto_id` evitaba el deadlock. No alcanza: hay dos casos que siguen cruzándose, y uno ocurre **hoy en producción**: `ajustar_stock` (la usa la devolución de eliminar) contra una venta de dos productos.
2. La causa es el trigger `bump_catalogo` de `producto_stock`. Se arregla con **orden + trigger diferido al COMMIT**, sin tocar la RPC aprobada: 0 deadlocks en 1.200 operaciones concurrentes (la viva: 54 y 78).
3. El defecto de la devolución está **confirmado y reproducido**: si falla un paso, queda `stock_descontado = false` con el stock devuelto a medias y el reintento no puede completarlo. La RPC `devolver_stock_pedido` lo resuelve en una sola transacción (15/15).
4. **Arqueos es crítico**: cualquiera con la anon key puede leer y modificar arqueos de todas las empresas, y alterar el stock cuando el admin confirma (reproducido). Hay corrección y reversión probadas (60/60), con una dependencia dura: desplegar `arqueo-servidor` antes de la parte B.
5. La disponibilidad por presentación queda diseñada: la presentación no desaparece, se ve "No disponible / Quedan N", el servidor sigue con `SIN_STOCK`. Helper con 13 pruebas.
6. Para la validación integral necesito un `pg_dump --schema-only` de `public` que solo corre JC (sección 5).

## 2. Compras: rama correctiva

Rama `fix/compras-orden-lineas` (desde `main`, sin mezclar con Stock V2). Detalle y evidencia en `supabase/tests/compras-orden/INFORME-COMPRAS.md`.

- `_ingresar_compra_stock`: valida en orden original, aplica ordenado por `producto_id`. **13 de 13** casos idénticos a la viva (retorno, errores, stock, libro).
- Matriz de cruces con la venta (RPC viva, escritor instrumentado):

| Caso | Viva | Solo orden | Orden + trigger diferido |
| --- | --- | --- | --- |
| Compra en orden inverso vs venta | deadlock | pasa | pasa |
| Compra [lo,hi] vs venta {hi} | deadlock | **deadlock** | pasa |
| `ajustar_stock(hi)` vs venta {lo,hi} | deadlock | **deadlock** | pasa |
| Compra vs venta en el mismo orden | pasa | pasa | pasa |

- Estrés de 600 operaciones con 24 hilos: viva 54 y 78 deadlocks, 30 a 42 s; propuesta 0 y 0, 2,5 s; el libro cierra en todas. Es contención extrema a propósito, sirve para comparar, no para estimar la frecuencia real.
- Diferencia observable de la función: con varias líneas inválidas puede salir otra excepción (la transacción aborta igual).

## 3. Disponibilidad (diseño)

Detalle en `supabase/propuestas/disponibilidad/DISENO-DISPONIBILIDAD.md`.

- **Regla:** disponible si `stock − ya_comprometido >= factor_stock`. "Comprometido" suma el carrito y las cantidades marcadas de todas las presentaciones del mismo producto, que comparten stock físico. Promos con componentes: backtracking sobre sus slots.
- **Dónde:** el servidor manda `factor_stock`, `max_unidades`, `disponible` y `sin_stock_motivo` por presentación (campos opcionales, los clientes viejos los ignoran); el cliente recalcula contra el carrito con el mismo helper puro.
- **UX:** la presentación se queda en el catálogo, atenuada, con "No disponible" / "Agotado" / "Quedan N" y el "+" bloqueado, en kiosco, mesa, delivery, takeaway, caja y admin.
- **409:** solo cambia el cuerpo de la respuesta de `/api/pedidos` (código y producto). El cliente refresca la disponibilidad y vuelve al carrito, siguiendo el patrón existente de precios desactualizados. La RPC aprobada no se toca.
- Rama propia `feature/stock-disponibilidad`, unos 11 archivos, 1,5 a 2 días más 1 de pruebas.
- **Decisiones para el CTO:** (a) `stock_unidades` expone el stock real en un endpoint público; alternativa, toparlo en 99. (b) Con `mostrar_agotados` apagado, el producto con stock 0 sigue ocultándose entero (decisión de producto previa); la regla nueva solo cubre "hay stock pero no alcanza para esa presentación".
- Helper `disponibilidad.ts`: 13 de 13 pruebas de Node. Falta UI, API y realtime (van en el punto 5).

## 4. Arqueos y devoluciones

### 4.1 Seguridad de arqueos (incidente separado)

Detalle en `supabase/propuestas/arqueos-seguridad/AUDITORIA-ARQUEOS.md`.

- **Crítico:** policies `USING (true)` para todos los roles y `GRANT ALL` a `anon` en `arqueos_stock` y `arqueo_items`. Lectura, alta, modificación y borrado entre empresas con la anon key.
- **Impacto reproducido:** un anónimo cambia `fisico` de un arqueo pendiente ajeno; cuando el admin legítimo confirma, el stock queda en 5000 en vez de 48.
- **Medio:** `bump_catalogo_*` ejecutables por cualquier `authenticated` con ids ajenos; un arqueo falso `pendiente` bloquea el arqueo real de la sucursal.
- **Bien (verificado):** `ajustar_stock` y `confirmar_arqueo_stock` rechazan con `FORBIDDEN` a un admin de otra empresa; `crear_arqueo_stock` es solo `service_role`.
- **Corrección** en dos partes: A (`trg_bump_catalogo` SECURITY DEFINER + revocar EXECUTE), aplicable ya; B (policies por empresa, `anon` sin permisos, `authenticated` con SELECT y UPDATE de columnas), **solo después de desplegar `arqueo-servidor`**, porque hoy la caja de `main` crea arqueos desde el navegador gracias a la policy abierta.
- Evidencia: 60 de 60; los 11 ataques prosperan antes y quedan bloqueados después; los flujos legítimos siguen; la reversión devuelve la huella idéntica.
- **No verificado sin la base real:** otras policies o grants no volcados, el rol de la caja en producción, edge functions que lean arqueos. Hay SELECT de solo lectura listos para que JC los corra (sección 6 de la auditoría); el SELECT 7 dice si el agujero ya fue explotado.
- **Interacción a probar:** la parte A y el trigger diferido tocan el mismo trigger. Compatible por diseño, pendiente de probar juntos en el punto 5.

### 4.2 Devolución transaccional

Detalle en `supabase/propuestas/devolucion-transaccional/`.

- **Defecto confirmado:** la ruta baja `stock_descontado` y devuelve el stock en llamadas separadas; las respuestas de `ajustar_stock` no se verifican. Una falla en el segundo producto deja flag en false, un producto devuelto y otro no, y el reintento no puede completar. Reproducido (prueba 6c).
- **Propuesta:** `devolver_stock_pedido(empresa, pedido)`, una transacción: lock del pedido, si ya está en false no hace nada, cálculo por snapshot (`cantidad × coalesce(factor_stock_snap, 1)`), productos ordenados por `producto_id`, ajuste por `ajustar_stock` (mismo libro), baja del flag al final. Si algo falla, rollback total y el reintento funciona. No toca otros datos del pedido ni pedidos con flag en false. Solo `service_role`.
- **15 de 15:** x8 + porción + lata, repetida (no-op), test histórico (8, cambio a 10, devuelve 8), snapshot NULL (4 devuelve 4, no 32), falla intermedia con rollback total y reintento correcto, 8 hilos sobre el mismo pedido (1 devuelve), ventas y devoluciones cruzadas (0 deadlocks, libro cierra), permisos (anon y PUBLIC sin EXECUTE), reversión.
- **Ruta:** `eliminar.route.propuesta.ts.txt` reemplaza ~35 líneas por una llamada a la RPC; si falla responde 500 sin borrar el pedido. `src/lib/stock/devolucion.ts` queda sin uso en la ruta (sirve de especificación del cálculo; se puede retirar).
- Alcance: solo la eliminación de pedidos no cobrados. No hay otro camino que devuelva stock; la anulación por Nota de Crédito no devuelve stock (decisión de V1, no se cambia).

## 5. Validación integral (punto 5)

Plan en `supabase/propuestas/validacion-integral/PLAN-VALIDACION-INTEGRAL.md`.

- **Hecho:** matriz completa en el entorno reducido (24/24 de V2, 13/13 y estrés de Compras, 15/15 de devolución, 60/60 de arqueos, 13/13 del helper de disponibilidad).
- **Pendiente:** ruta HTTP real, admin y kiosco con Playwright, RLS/PostgREST reales y las pruebas combinadas. PostgREST 12.2.12 ya está descargado y verificado en el entorno.
- **Bloqueo:** necesito el esquema real. **JC corre, con su contraseña, `pg_dump --schema-only --schema=public --no-owner` y adjunta el archivo** (datos: ninguno). Comandos exactos en el plan.
- No es reproducible acá: Realtime real, GoTrue, carga de producción.

## 6. SQL definitivo y reversión (orden de aplicación propuesto, SIN aplicar)

| # | Archivo | Reversión | Depende de |
| --- | --- | --- | --- |
| 1 | `stock-v2-factor-migracion.sql` | `stock-v2-factor-REVERSION.sql` | nada |
| 2 | `rpc-crear-pedido-stock-v2-factor.sql` | ídem (reinstala la viva) | 1 |
| 3 | `stock-bump-diferido.sql` | `stock-bump-diferido-REVERSION.sql` | nada |
| 4 | `compras-ingresar-stock-orden.sql` | `compras-ingresar-stock-orden-REVERSION.sql` | 3 recomendado |
| 5 | `devolver-stock-pedido.sql` (+ cambio de la ruta) | `devolver-stock-pedido-REVERSION.sql` (primero volver la ruta) | 3 |
| 6 | Arqueos parte A | `arqueos-seguridad-REVERSION.sql` (parte A) | 3 (probar juntos) |
| 7 | Deploy de `arqueo-servidor` | — | — |
| 8 | Arqueos parte B | `arqueos-seguridad-REVERSION.sql` (parte B, reabre el agujero) | 7 |

La validación integral (punto 5) corre esta secuencia completa, con reversión paso a paso, antes de proponer el GO productivo.

## 7. Decisiones que pido al CTO

- [ ] Confirmar el enfoque **orden + trigger diferido** (y que cambiar el trigger de `producto_stock` entra en el alcance, aunque no toca la RPC aprobada).
- [ ] Prioridad de la parte A de arqueos y del plan para desplegar `arqueo-servidor` (la parte B es la que cierra el agujero crítico).
- [ ] Topar `stock_unidades` en 99 o exponer el stock real en el catálogo público.
- [ ] Autorizar a JC a correr el `pg_dump` de solo esquema y los SELECT de solo lectura de la auditoría.
