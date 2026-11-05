# Validación combinada: trigger diferido + parte A de arqueos + Compras ordenada + devolución

5/11/2026 · Orden CTO 05/11 (sección G, puntos 3, 4 y 5 parciales) · entorno aislado (Postgres 16 local, esquema reducido, sin RLS de PostgREST real todavía)

**Resultado: todo pasa, sin conflicto entre los cuatro cambios.**

| Prueba | Configuración | Resultado |
| --- | --- | --- |
| Seguridad de arqueos (ataques A1–A11, controles C, flujos legítimos L1–L10, reversión, reaplicación) | Trigger de `producto_stock` **diferido** + parte A + parte B | **60 de 60**. L8 y L9 (el catálogo y el stock del admin siguen subiendo la versión de catálogo) pasan con el trigger diferido y `SECURITY DEFINER` |
| Venta (RPC viva) contra Compras ordenada / `ajustar_stock` (4 cruces) | Orden + diferido + parte A | **4 de 4**, sin deadlock |
| Estrés 600 operaciones, 24 hilos | Orden + diferido + parte A | **0 deadlocks**, libro cierra, 2,3 s |
| Devolución transaccional (15 pruebas, incluidas falla intermedia, 8 hilos y ventas cruzadas) | Diferido, con y sin parte A | **15 de 15** en ambos casos |

## Estado real de la base compartida (SELECT de solo lectura del 5/11)

- Policies `arq_all` y `arqi_all` con `USING (true)` para `public`; `anon` con `SELECT/INSERT/UPDATE/DELETE/TRUNCATE` sobre ambas tablas. Coincide con el volcado versionado.
- `bump_catalogo_empresa` y `bump_catalogo_sucursal`: ejecutables por `authenticated`. `trg_bump_catalogo`: no es `SECURITY DEFINER`.
- 14 arqueos (12 confirmados, 2 pendientes). Sin altas cruzadas entre empresas, sin arqueos vacíos ni con productos de otra empresa, sin diferencias de 1.000 o más ni físicos negativos. Logs de API de las últimas 24 h: 0 pedidos a `arqueos_*` (hay 36.901 requests REST en la ventana, el filtro funciona).
- **Lectura:** no hay indicios de explotación. No se puede afirmar que no la hubo: los logs retienen 24 h y los SELECT no detectan lecturas ni ediciones plausibles.

## `feature/arqueo-servidor`

- 3 commits propios (alta por servidor con `device_token` y sesión de operador, confirmación sin repetir ítems ajustados, y un aviso de pago que ya existe en `main` con otro hash). 6 archivos, +370 −44.
- Está 5 commits detrás de `main`. Simulé el merge sin tocar el repo: 3 archivos modificados en ambas ramas, **0 marcas de conflicto** (se fusiona solo).
- Falta antes del despliegue: probar la ruta `/api/operacion/arqueo` y la caja contra PostgREST real (punto 6 de la orden) y la autorización específica de despliegue.

## Límites

Esquema reducido. RLS vía PostgREST real, API y UI quedan para la validación integral, que necesita el volcado `pg_dump`.
