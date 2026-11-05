# ConeOS — Relevamiento de seguridad (05/11/2026)

Alcance: base Supabase compartida (inventario por SELECT de solo lectura) + 42 rutas API (revisión de código). No se ejecutó ningún ataque, ningún DDL/DML, ninguna petición contra producción.
Detalle de rutas: `SEGURIDAD-API.md`. SQL propuesto: `seguridad-general-correccion.sql` + `seguridad-general-REVERSION.sql` (**sin probar, sin aplicar**).

## 1. Veredicto (el 80%)

**Hoy ConeOS no está listo para exponerse sin riesgo.** El problema principal no es la base: es que casi toda la API es anónima y usa `service_role`, confiando en ids que manda el cliente. Los 6 puntos que importan:

| # | Sev. | Qué pasa | Quién puede |
|---|---|---|---|
| 1 | CRÍTICA | Emitir Notas de Crédito ARCA reales sobre facturas de cualquier comercio (`/api/facturacion/nc`), apagar `auto_facturar`. Verificado en código: sin auth, service key. | Cualquiera con el slug del comercio |
| 2 | CRÍTICA | Marcar pedidos como cobrados (`/api/pedidos/estado`, `/api/mesa/cobrar`, `venta_caja:true`) → comida gratis + factura emitida. | Cualquier cliente |
| 3 | CRÍTICA | XSS almacenado: `comanda`, `ticket`, `ticket-cuenta` no escapan nombre/dirección; se imprimen con `document.write` en la caja, donde la sesión admin está en `localStorage`. | Cualquier cliente del kiosk |
| 4 | ALTA | "Auth por dispositivo" con UUID público: `/api/device/verify` lo devuelve con solo slugs → `operacion/consulta` vuelca PII e historial y controla delivery. | Cualquiera |
| 5 | ALTA | Sin rate limit en PIN de operador/cadete (4 dígitos). | Cualquiera |
| 6 | ALTA | RLS `USING (true)` en `arqueos_stock`/`arqueo_items` (lectura/escritura cross-tenant con la anon key). Ya cubierto por `arqueos-seguridad` (A/B). | Cualquiera con anon key |

Bug adicional confirmado en código: `src/lib/pagos/mp.ts:256` — `conTokenFresco` devuelve objeto y se usa como string (`Bearer [object Object]`); la verificación manual contra MP **siempre falla** y el caller falla abierto. `next.config.ts` tiene `ignoreBuildErrors: true`, por eso nadie lo vio.

Lo bueno: sin secretos hardcodeados; `.env.local` no versionado; service role no expuesta al bundle; rutas admin (`cuits`, `pagos-cuentas`, `compras`, `catalogo/canal`) derivan empresa de la sesión; cert/clave ARCA write-only; `crear_pedido_stock` es server-authoritative en precio.

## 2. Base de datos (SEG-1…6, archivo SQL)

| ID | Sev. | Corrección | Depende de código |
|---|---|---|---|
| SEG-1 | Alta | Revocar EXECUTE a anon/public en `get_db_size`, `get_table_stats`, `set_pin_*`; vistas `facturacion_config_admin` y `v_saldo_proveedor` a `security_invoker`; quitar TRUNCATE/REFERENCES/TRIGGER a anon/authenticated. | **Verificar Panel QP** (repo aparte): si llama `get_db_size/get_table_stats` con anon key se rompe. `set_pin_*` lo usa el admin logueado (authenticated): NO revocar a authenticated. |
| SEG-2 | Media | Drop de policies `service_insert_pedido_items/_opciones` (service_role ya salta RLS). | No |
| SEG-3 | Alta | Storage: sacar insert/update/delete públicos; escritura solo authenticated en `productos/logos/assets`; límites de tamaño y MIME. | `capturas` se sube por `/api/pedidos/comprobante` (service) → no afectada. Probar subida de imágenes del admin. |
| SEG-4 | Alta | `facturacion_config` y `mp_credenciales`: sin SELECT de columnas secretas (`cert_pem`, `key_pem`, `access_token`, `refresh_token`) para authenticated. | Verificado: en `src/` solo las usa código server (`facturar.ts`, `mp.ts`, `resolver.ts`) con service client; ningún componente cliente las consulta. |
| SEG-5 | Media | `cierres_caja`: hoy se inserta desde el navegador (`ventas/page.tsx:247`, `VistaCaja.tsx:231`). Cambio de policy **comentado**, requiere ruta `/api/operacion/cierre`. | Sí (código nuevo) |
| SEG-6 | Media | Activar "Leaked password protection" en Auth (manual, dashboard). | No |

## 3. API — plan de corrección (código, no SQL)

Orden por riesgo/esfuerzo. Cada fase es un PR chico y reversible.

**Fase 1 — rápida, sin cambio de arquitectura (1–2 días)**
1. Escapar HTML en `comanda`, `ticket`, `ticket-cuenta` (módulo `esc()` común, ya existe en `factura`) + sanear/limitar largo de `datos_delivery` y nombres snap en `/api/pedidos`.
2. Arreglar `mp.ts:256` (`const t = await conTokenFresco(...)`; usar `t.access_token`; `!t.ok` → `inaccesible`) y decidir si el fail-open sigue.
3. Reactivar chequeo de tipos en build (puede aflorar más errores: hacerlo en rama aparte).
4. Cabeceras de seguridad en `next.config.ts` (CSP, frame-ancestors, Referrer-Policy) y SRI/empaquetar `qrcodejs`.
5. Errores genéricos (sin `error.message`/`debug` al cliente).
6. Confirmar en dashboard `verify_jwt` de `arca-facturar`; en la función, rechazar si `Authorization` ≠ service key; sacar CORS `*`.

**Fase 2 — autenticar lo sensible (3–5 días)**
7. `facturacion/nc` y `facturacion/emitir` (GET/PUT/POST): Bearer admin + `empresa_id` de sesión (plantilla de `admin/cuits`). Sacar POST público de `emitir`.
8. `pedidos/eliminar`, `pedidos/estado`, `mesa/cobrar`, `beneficios`, `visitas/resumen`: exigir `device_token` (secreto) o sesión de operador firmada; whitelist de transiciones de estado; guard `pagado=false`.
9. `venta_caja`, `cuenta_transferencia_id`, `mp_credencial_id` en `/api/pedidos`: ignorar si no viene de dispositivo de caja autenticado.
10. `device/verify` modo 2 sin devolver `id`; `operacion/consulta` y `operador/lista` por `device_token`.
11. `mp/connect`/`callback`: `state` firmado (HMAC + nonce + expiración) iniciado desde ruta autenticada.

**Fase 3 — endurecer (1 semana)**
12. Rate limit/lockout de PIN (tabla de intentos o Upstash/Vercel KV), token de sesión de operador verificado por las rutas, PIN 6 dígitos.
13. Token firmado de pedido para el cliente (en vez del UUID crudo en `estado`, `comprobante`, `reparto`).
14. `comprobante`: validar MIME/magic bytes, sin `upsert`.
15. Webhook MP: `x-signature`, comparar monto, sin barrido de credenciales.
16. `empresaDelAdmin` por `usuarios_admin` + `getUser(token)` + chequeo de rol en `cuits` y `compras`.
17. Cierre de caja server-side (SEG-5).

## 4. Orden de aplicación recomendado

1. Fase 1 de código (no depende de DB, bajo riesgo) → deploy.
2. SQL: arqueos Parte A → SEG-2 → SEG-1 (tras verificar Panel QP) → SEG-4 → SEG-3.
3. Fase 2 de código; luego `arqueo-servidor` y arqueos Parte B (ver plan Stock V2).
4. SEG-5 con la ruta de cierre; SEG-6 manual.
5. Fase 3.

Todo el SQL requiere GO del CTO por ser la base compartida LAB/prod, y probarse antes en el entorno aislado.

## 5. Qué NO está verificado

- RLS vivas de `empresas`, `pedidos`, `dispositivos`, `operadores`, `usuarios_admin` y policies de buckets (el dump `pg_dump --schema-only --schema=public` cerraría esto).
- `verify_jwt` de `arca-facturar`.
- GRANT EXECUTE a anon de RPC fuera del repo (`verificar_pin_operador`, `registrar_orden_pago`, `aplicar_credito_op`, `ajustar_stock`…): chequeable con un SELECT sobre `information_schema.routine_privileges`.
- 98 escrituras desde cliente con anon key: dependen enteramente de RLS.
- Vercel (WAF, rate limits, env de producción).
- Los hallazgos de API son por lectura de código; H-01 (nc) y el bug de `mp.ts:256` los confirmé yo directamente en el archivo.
- Los SQL SEG-1…6 no fueron probados.

## 6. Rotación de secretos

No hay evidencia de fuga de secretos, así que no se pide rotar. Si hubo exposición del `empresa_id` + ARCA, el daño sería NC emitidas: revisar tabla `facturas` por `tipo_cbte = 13` inesperadas (SELECT de solo lectura).
