# Seguridad de la API de ConeOS (revision de solo lectura)

Fecha: 2026-11-05. Repo: `$HOME/mnt/coneos` (Next.js 16.2.12 App Router + Supabase, proyecto `wpiwjpvjqshsgrxxwsld`).
Alcance: 42 archivos `src/app/api/**/route.ts` (51 handlers HTTP), `src/proxy.ts`, `src/lib/supabase/*`, `src/lib/pagos/*`, `src/lib/facturacion/*`, `src/lib/beneficios.ts`, Edge Function `supabase/functions/arca-facturar`, `next.config.ts`, nombres de variables de `.env.local`, SQL versionado en `supabase/`.
No hay server actions (`'use server'`: 0 archivos). No se modifico nada, no se ejecuto SQL ni se llamo a Supabase.
Convencion de citas: `archivo:linea` con numeracion del archivo tal como esta hoy. Ningun valor de secreto fue impreso ni copiado.

## 1. Resumen ejecutivo

- 42 rutas / 51 handlers. Solo 4 rutas autentican a una persona real (Bearer de sesion Supabase del admin): `admin/cuits`, `admin/pagos-cuentas`, `catalogo/canal`, `compras`.
- `src/proxy.ts` (el "middleware" de Next 16) es un no-op: `return NextResponse.next()` (`src/proxy.ts:3-5`). No protege nada. No hay CORS en las rutas Next (solo same-origin por defecto del navegador, que no frena a un atacante con curl); la Edge Function responde `Access-Control-Allow-Origin: *` (`supabase/functions/arca-facturar/index.ts:38`).
- 34 rutas son anonimas: unas 17 publicas por diseno (catalogo, contexto, horario, manifest, etc.) y 17 anonimas con efecto sensible (dinero, facturacion, borrado, PII). Ver tabla.
- El patron dominante es: `createAdminClient()` (service_role, salta RLS) + ids tomados del body/query sin comprobar pertenencia. La "autoridad" de varias reglas de negocio vive en el cliente (por ejemplo `venta_caja` en `/api/pedidos`).
- Lo mas grave: cualquier persona de internet, sin cuenta, puede (a) emitir Notas de Credito ante ARCA que anulan las facturas de cualquier comercio, (b) marcar como cobrado cualquier pedido (food gratis y factura emitida), (c) volcar datos personales de clientes (telefono, direccion) del historial completo, y (d) ejecutar JavaScript en la maquina de caja mediante HTML de comanda/ticket sin escapar.

## 2. Modelo de autenticacion observado

| Mecanismo | Donde | Evaluacion |
|---|---|---|
| Bearer del admin, cliente Supabase con anon key + header `Authorization` (RLS), empresa = `empresas.select('id').limit(1)` | admin/cuits, admin/pagos-cuentas, catalogo/canal, compras | Correcto en espiritu (la empresa sale de la sesion, no del body). Debilidades: ver H-10 (limit(1) sin orden ni filtro, sin chequeo de rol). |
| `dispositivo_id` (UUID) en el body | operacion/consulta, operador/lista | No es un secreto: lo devuelve `/api/device/verify` con solo slugs publicos (ver H-04). Es autenticacion nula en la practica. |
| `device_token` | device/verify (modo 1), manifest, pwa-manifest | Token en la URL `/{empresa}/d/{token}`. Aceptable como bearer de dispositivo, pero el modo 2 de device/verify lo esquiva. |
| PIN de operador / cadete | operador/login, reparto login | Sin rate limit ni bloqueo; PIN de 4 a 6 digitos. El login de operador no emite token: la "sesion" es solo estado del navegador, ninguna ruta la verifica. |
| Token de cadete (`colaborador_sesiones`, 14 dias) | reparto (acciones privadas) | Bien validado en cada request (`reparto/route.ts:40-50`). Sin logout/revocacion. |
| Firma de webhook | mp/webhook | No hay verificacion de `x-signature`. Se compensa consultando el pago a MP (verify-by-fetch). |
| Identidad ARCA | Edge Function | El codigo no verifica quien llama (`index.ts:371-377`); depende de `verify_jwt` de la plataforma (no versionado en el repo). |

Sesion del admin en el navegador: `src/lib/supabase/client.ts:36-47` guarda la sesion en `localStorage` (`coneos-auth`). El cliente de servidor (`server.ts`) lee cookies, por eso las rutas usan Bearer manual. Consecuencia: cualquier XSS en el origen roba la sesion del admin (ver H-03).

## 3. Tabla de rutas

Leyenda. Cliente: SR = `createAdminClient` (service_role), RLS = cliente con el Bearer del usuario, ANON = anon key. Valida empresa: Si / No / Parcial. Riesgo: A / M / B (Alto, Medio, Bajo). "Publica" = lectura anonima por diseno.

| Ruta | Metodo | Cliente | Autenticacion | Valida empresa | Riesgo | Nota (archivo:linea) |
|---|---|---|---|---|---|---|
| /api/admin/cuits | GET, POST | RLS (identidad) + SR (mutacion) | Bearer admin | Si (empresa de sesion; ids se filtran `.eq('empresa_id')`) | M | `cuits/route.ts:22-34,54-72`. Maneja cert/key ARCA. Sin chequeo de rol (`auth_rol`). `empresaDelAdmin` = `limit(1)` sin orden (H-10). `probar_cuit` llama a la Edge con la service key (`:183-189`). Key privada write-only: bien (`:49-52`). |
| /api/admin/pagos-cuentas | GET, POST | RLS | Bearer admin | Si (sucursal, cuenta y credencial verificadas contra empresa; `:301-304,436-449`) | B | `pagos-cuentas/route.ts:33-49,306-505`. No lee tokens MP. Mismo `limit(1)`. `set_llave` llama a `resolverPago` (SR) pero solo lectura. |
| /api/beneficios | GET, PUT, POST | SR | Ninguna | No | A | `beneficios/route.ts:7-31` consulta saldo por telefono+empresa_id (enumeracion de clientes). `:35-73` PUT descuenta puntos de cualquier telefono con solo un `pedido_id`; `opciones` sin filtro de empresa (`:51-52`); sin idempotencia (`:62-70`); read-modify-write sin lock. `:78-103` POST vincula telefono a cualquier pedido. |
| /api/catalogo/canal | GET, POST | RLS (identidad) + SR | Bearer admin | Si (`:169-172` update filtrado por empresa) | B | `catalogo/canal/route.ts:41-88`. Filtra bien. Filtra `error.message.slice(0,80)` (`:73`). |
| /api/compras | POST | RLS (identidad) + SR | Bearer admin | Si (todas las queries `.eq('empresa_id')`; RPC reciben `p_empresa_id` de sesion) | M | `compras/route.ts:47-53`. Toca dinero: OP, cheques, anulaciones (`:620-706`), stock (`:393-520`). Sin chequeo de rol. Cuerpo de errores RPC filtrado al cliente (`:121,482,630,675,689,703`). La autoridad real de multi-tenant en los RPC (`aplicar_credito_op`, `registrar_orden_pago`, etc.) no esta en el repo: no verificable. |
| /api/comprobantes/comanda | POST | SR | Ninguna | No | A | `comanda/route.ts:5-19`. Devuelve HTML con nombre, telefono, direccion de cualquier pedido por UUID. XSS almacenado: `:57-68,112-121,137` interpolan sin escapar. |
| /api/comprobantes/factura | GET | SR | Ninguna | No | M | `factura/route.ts:24-32` por `factura_id` (UUID): CUIT emisor, receptor, items, CAE. Aqui si hay `esc()` (`:59,65,113-116`). Carga `qrcodejs` de cdnjs sin SRI (`:132`). |
| /api/comprobantes/ticket | POST | SR | Ninguna | No | A | `ticket/route.ts:6-23`. PII + datos fiscales por UUID. XSS: `nombre_cliente` del body sin escapar (`:227`), `receptor.razon` (`:196`), `detalle_facturable` (`:208`), `descuento_cobro_detalle` (`:213`), items. |
| /api/comprobantes/ticket-cuenta | POST | SR | Ninguna | No | A | `ticket-cuenta/route.ts:8-17`. Sin escapar nada (`:46-88`). Ademas se escribe con `document.write` (`VistaCaja.tsx:673`). |
| /api/device/verify | POST | SR | `device_token` (modo 1) / ninguna (modo 2) | Parcial | A | `verify/route.ts:10-28` modo token. `:30-55` modo slug: con `empresa_slug+sucursal_slug+tipo='DELIVERY'` devuelve el `id` del dispositivo, que es la "credencial" de operacion/consulta. |
| /api/dispositivos/latido | POST | SR | Ninguna | No | B | `latido/route.ts:12-21` upsert con `empresa_id` arbitrario y `onConflict: instancia_id`: contaminar/mover filas de heartbeat. |
| /api/empresa/config | GET | SR | Ninguna (publica) | n/a | B | `empresa/config/route.ts:4-25`. Entrega `empresa_id` y `plan` a partir de un slug: es el primer eslabon de toda enumeracion (H-01). |
| /api/facturacion/emitir | GET, PUT, POST | SR + Edge (service key) | Ninguna | No (PUT/GET confian en `empresa_id` del cliente; POST valida solo par pedido-empresa del cliente) | A | `emitir/route.ts:19-38` GET config; `:41-52` PUT cambia `auto_facturar` y `metodos_auto` de cualquier empresa (y filtra `error.message`, `:50`); `:56-85` POST dispara emision ARCA con la service key (`:74-82`). |
| /api/facturacion/nc | GET, POST | SR + Edge (service key) | Ninguna | Parcial (par pedido+empresa del cliente, `:33-35`) | A | `nc/route.ts:6-21` GET lista todos los `pedido_id` facturados de una empresa (enumerador). `:25-49` POST emite Nota de Credito C (anula la factura) via Edge. |
| /api/hora-argentina | GET | SR | Ninguna (publica) | n/a | B | `hora-argentina/route.ts:5-49`. Lee config de cualquier sucursal por id (datos operativos publicos). |
| /api/kiosk/catalogo | GET | SR | Ninguna (publica) | Si (filtra por `empresa_id` y `sucursal_id` del query, sin verificar que sucursal sea de la empresa) | B | `kiosk/catalogo/route.ts:4-130`. `presentacion_grupos` sin filtro de empresa (`:37`). Sin paginacion. |
| /api/kiosk/config | GET | SR | Ninguna (publica) | n/a | B | `kiosk/config/route.ts:4-23`. |
| /api/kiosk/horario | GET | SR | Ninguna (publica) | n/a | B | `kiosk/horario/route.ts:14-44`. |
| /api/kiosk/pagos | GET | SR | Ninguna (publica) | n/a | B | `kiosk/pagos/route.ts:16-65`. Devuelve alias/CBU y titular de transferencia (dato que se muestra al cliente por diseno). No devuelve tokens MP: bien. |
| /api/manifest | GET | SR | `token` opcional | n/a | B | `manifest/route.ts:24-45`. Reconstruye `start_url` con el token del dispositivo (`:37`): solo si ya lo conoces. |
| /api/mesa/cobrar | POST | SR | Ninguna | No | A | `mesa/cobrar/route.ts:63-198`. Cualquiera marca pedidos de mesa como pagados (`:174-182`), registra `pedido_pagos` (`:149`), fija receptor fiscal (`:153-161`) y dispara ARCA (`:184`). `error.message` al cliente (`:150`). Sin guard `pagado=false` en el UPDATE (`:175-181`). |
| /api/mesa/contexto | GET | SR | Ninguna (publica) | n/a | B | `mesa/contexto/route.ts:11-60`. |
| /api/mp/callback | GET | SR | Ninguna (callback OAuth sin `state` firmado) | No | A | `mp/callback/route.ts:18-27` parsea `state` base64 sin firma; `:49-58` guarda tokens MP del atacante en la empresa del state (H-06). |
| /api/mp/connect | GET | ninguno | Ninguna | No | M | `mp/connect/route.ts:23-36`. Fabrica `state` sin firma ni nonce ni sesion. |
| /api/mp/estado | GET | SR | Ninguna | No | B | `mp/estado/route.ts:8-32`. Revela si una empresa/sucursal tiene MP conectado. |
| /api/mp/preferencia | POST | SR (lee token MP) | Ninguna | No | M | `mp/preferencia/route.ts:12-106`. Crea preferencia de cualquier pedido, usa el token del comercio. Regex de origen permitido `^coneos(-[a-z0-9-]+)?\.vercel\.app$` (`:45`) acepta cualquier proyecto Vercel llamado `coneos-algo` (back_urls hacia dominio ajeno). No chequea que el pedido sea `mp` ni que este pendiente. |
| /api/mp/webhook | POST | SR | Sin firma (verify-by-fetch) | Parcial (`:50-55` pedido debe ser de la empresa de la credencial) | M | `mp/webhook/route.ts:20-74`. Sin `x-signature`; sin comparar `transaction_amount` con `pedido.total`; sin `payment.status` de moneda/collector. Sin `?c=` cae al barrido de TODAS las credenciales (`lib/pagos/mp.ts:213-215`): cada POST falso fuerza N llamadas a MP (amplificacion). Idempotente por estado PENDING_PAYMENT: bien. |
| /api/operacion/consulta | POST | SR | `dispositivo_id` (no secreto) | Si, respecto del dispositivo (empresa/sucursal salen del registro, `:18-21`); No respecto del llamador | A | `operacion/consulta/route.ts:12-21`. `pedidos_hoy` y `historial` devuelven pedidos con `datos_delivery` (PII), `verTodas` salta el filtro de sucursal (`:42,74`). Mutaciones sin identidad: `comanda_auto_set` (`:122-135`), `ticket_auto_set` (`:149-161`), `delivery_pausado_set` (`:214-217`), `asignar_cadete` que pasa pedidos a READY (`:248-288`). |
| /api/operador/lista | POST | SR | `dispositivo_id` (no secreto) | Si (por dispositivo) | M | `operador/lista/route.ts:10-33`. Lista operadores activos por id: primer paso del brute force de PIN. |
| /api/operador/login | POST | SR | PIN | Parcial (`empresa_id` del body cruzado con el operador `:14-19`; `dispositivo_id`, `sucursal_id` no se validan `:40-49`) | A | `operador/login/route.ts:4-63`. Sin rate limit/bloqueo; PIN de 4-6 digitos (`SeleccionOperador.tsx:54-58`). No entrega token: nadie lo verifica despues. |
| /api/operador/logout | POST | SR | Ninguna | No | B | `operador/logout/route.ts:4-20` cierra cualquier `session_id`. |
| /api/pedidos/comprobante | POST | SR + Storage | Ninguna | No | M | `pedidos/comprobante/route.ts:11-71`. Sube a bucket publico `capturas` con `upsert:true` en `pedidos/{id}.{ext}` (`:34-38`): sobrescribe capturas de otros. Sin validacion de tipo de archivo, `contentType` del cliente, `ext` del nombre. `error.message` al cliente (`:38,43,69`). Pisa `notas` de cualquier pedido por transferencia (`:62-68`). |
| /api/pedidos/eliminar | POST | SR | Ninguna | No | A | `pedidos/eliminar/route.ts:7-99`. Borra cualquier pedido no cobrado (PENDING_PAYMENT o mesa sin pagar), repone stock (`:37-65`), revierte puntos y borra items. Destructivo. |
| /api/pedidos/estado | GET, POST | SR | Ninguna | No | A | `pedidos/estado/route.ts:12-25` GET: estado, total, `datos_delivery` por UUID. `:52-146` POST: cualquier `estado_nuevo` (sin whitelist ni maquina de estados) por `pedido_id`; pasa a PREPARING/DELIVERED, acredita puntos (`:137`) y factura (`:141`). Validacion MP manual rota (H-02). `operador_id` del body solo para log. |
| /api/pedidos/pendiente-mp | GET | SR | `visitante_id` (id de navegador) | n/a | B | `pendiente-mp/route.ts:12-41`. Devuelve `datos_delivery` del ultimo pedido MP del visitante; el `visitante_id` es un secreto debil. |
| /api/pedidos | POST | SR + RPC `crear_pedido_stock` (SECURITY DEFINER) | Ninguna | Parcial (la RPC valida sucursal∈empresa, precios, opciones: `crear_pedido_stock.vivo-2026-11-04.sql:42-44,139-204`) | A | `pedidos/route.ts:12-22` acepta `venta_caja`, `origen`, `costo_envio`, `cuenta_transferencia_id`, `mp_credencial_id` del cliente anonimo. `venta_caja:true` salta horario (`:67`), guard de medios de pago (`:210`), nace PREPARING (`:404`), aplica descuento efectivo (`:459-481`) y factura (`:484-487`). `dispositivo_id`/`visitante_id` sin validar contra la empresa (`:267`). Respuesta 400 con `debug` (`:28`) y `error.message` en 500 (`:434`). `p_costo_envio: Number(costo_envio)` va tal cual (`:400`; la RPC lo suma sin rango, `.sql:218`). |
| /api/pedidos-entrada/contexto | GET | SR | Ninguna (publica) | n/a | B | `pedidos-entrada/contexto/route.ts:39-199`. |
| /api/pwa-manifest | GET | SR | `token` opcional | n/a | B | `pwa-manifest/route.ts:9,12` `path` del query va a `start_url`/`id` sin validar. |
| /api/reparto | POST | SR | Mixta: acciones publicas + token de cadete | Si en acciones privadas (`:40-50,249-252`) | M | `reparto/route.ts:65-283`. Publicas: `pedido_publico` (`:75-116`, devuelve `datos_delivery` por UUID), `contexto` (lista de cadetes `:140-147`), `cliente_posicion` (ubicacion del cadete por UUID `:173-195`), `login` (`:151-168`, sin rate limit, PIN de 4 digitos, token 14 dias). |
| /api/takeaway/contexto | GET | SR | Ninguna (publica) | n/a | B | `takeaway/contexto/route.ts:32-135`. |
| /api/visitas | POST | SR | Ninguna | No | B | `visitas/route.ts:35-69`. Escritura anonima de analitica con `empresa_id` arbitrario (contaminacion de metricas). |
| /api/visitas/resumen | GET | SR | Ninguna | No | M | `visitas/resumen/route.ts:16-101`. Cualquiera lee trafico, referrers, ciudades y top de direcciones de entrega de cualquier empresa por `empresa_id`. |

Conteos (por archivo de ruta, 42 en total):
- Con identidad real (Bearer admin): 4.
- Con pseudo-autenticacion debil (`dispositivo_id` no secreto): 2 (`operacion/consulta`, `operador/lista`).
- Mixta (token de cadete en acciones privadas): 1 (`reparto`).
- Webhook sin firma: 1 (`mp/webhook`).
- Sin autenticacion alguna: 34 (17 publicas por diseno + 17 con efecto sensible).
- Que usan service_role sin validar empresa/pertenencia contra una identidad real: 19 rutas anonimas con datos o efectos sensibles + latido/visitas (escritura de baja criticidad) = 21; mas las 2 de `dispositivo_id` = 23 si se cuentan como "no validadas contra el llamador".

## 4. Hallazgos priorizados

### H-01 [CRITICA] Facturacion ARCA sin autenticacion: cualquiera anula y emite comprobantes fiscales de cualquier comercio
Archivos: `src/app/api/facturacion/nc/route.ts:6-49`, `src/app/api/facturacion/emitir/route.ts:19-85`, `src/app/api/empresa/config/route.ts:4-25`, `supabase/functions/arca-facturar/index.ts:371-377`.
Escenario concreto:
1. `GET /api/empresa/config?slug=<slug-del-comercio>` devuelve `id` (empresa_id).
2. `GET /api/facturacion/nc?empresa_id=<id>` devuelve la lista completa de `pedido_id` con factura emitida (`nc/route.ts:11-20`).
3. En un bucle, `POST /api/facturacion/nc {empresa_id, pedido_id}`: la ruta valida solo que el par exista (`:33-36`) y llama a la Edge con la service key (`:42-47`): se emite una Nota de Credito C real ante ARCA por cada factura, con el CUIT y certificado del comercio. El resultado es fiscalmente irreversible (la unica reversa es otra factura nueva) y deja la contabilidad del comercio anulada.
4. `PUT /api/facturacion/emitir {empresa_id, auto_facturar:false}` apaga la facturacion automatica de cualquier cliente sin dejar rastro (`emitir/route.ts:41-52`); `POST` emite facturas de pedidos cobrados o no (el chequeo es solo de metodo de pago, `:70-72`).
Agravante: la Edge Function no verifica quien llama en codigo y responde con `Access-Control-Allow-Origin: *`. Si `verify_jwt` esta activo (default), la anon key publica (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) ya es un JWT valido y se puede llamar directo a `/functions/v1/arca-facturar` con `accion: 'nota_credito'` sin pasar por Next. Si esta deshabilitado, es aun peor. No hay `config.toml` en el repo: no se puede saber.
Correccion propuesta (descripcion): (a) `nc` y `emitir` (PUT/GET) exigen Bearer de admin con la misma plantilla `rlsClient` + `empresaDelAdmin`, y `empresa_id` se deriva de la sesion, nunca del body; la NC ademas exige rol de admin de empresa; (b) `emitir` POST deja de ser un endpoint publico: la emision ya ocurre via `facturarSiCorresponde` en `lib/facturacion/facturar.ts`, asi que se elimina o se restringe a uso interno; (c) en la Edge Function, comparar el header `Authorization` con la service key (o un secreto propio) como primera linea y retirar el CORS `*`; confirmar `verify_jwt` en el dashboard; (d) `GET nc` pasa a devolver solo los ids de la empresa de la sesion.

### H-02 [CRITICA] Cualquiera puede marcar un pedido como cobrado (pedidos/estado, mesa/cobrar, venta_caja) y la verificacion de Mercado Pago esta rota
Archivos: `pedidos/estado/route.ts:52-146`, `mesa/cobrar/route.ts:63-198`, `pedidos/route.ts:18,67,210,404,459,484`, `lib/pagos/mp.ts:256-261`.
Escenario: un cliente del kiosk/delivery crea su pedido por transferencia o efectivo. La respuesta le da el `id` del pedido. Hace `POST /api/pedidos/estado {pedido_id, estado_nuevo:'PAID'}`: pasa a PREPARING con `pagado` del flujo, suma puntos y dispara la factura al CUIT del comercio (`:122-143`). No hay sesion, ni operador, ni dispositivo: `operador_id` es texto libre (`:53,129`). Para mesas, `POST /api/mesa/cobrar {pedido_ids, metodo_pago:'efectivo'}` registra el pago y factura (`:149-184`). En `POST /api/pedidos` el flag `venta_caja:true` (`:18`) convierte una compra anonima en una venta de mostrador que nace PREPARING, exenta de horario y de la politica de medios, y se factura sola (`:484-487`).
Para pedidos MP pendientes existe una validacion contra MP (`estado/route.ts:73-93`) pero esta rota: en `lib/pagos/mp.ts:256` `conTokenFresco` devuelve un objeto `{ok, access_token,...}` y la linea 261 arma `Bearer ${token}` (queda `Bearer [object Object]`), por lo que MP responde 401 y el resultado es siempre `inaccesible`, que el caller trata como fail-open y marca `pagado:true` (`estado/route.ts:88-92`). Nadie lo noto porque `next.config.ts:4-9` desactiva el chequeo de tipos y eslint en el build (`ignoreBuildErrors`, `ignoreDuringBuilds`).
Nota: afirmacion de lectura de codigo, no se ejecuto.
Correccion propuesta: todas las transiciones de estado y cobros pasan a una ruta autenticada por un secreto de dispositivo real (`device_token`) o por sesion de operador firmada (token emitido por `operador/login` y verificado en cada request), con empresa y sucursal derivadas del dispositivo; whitelist de transiciones (`PENDING_PAYMENT -> PREPARING -> READY -> DELIVERED`); `mesa/cobrar` con las mismas reglas y guard `pagado=false` en el UPDATE; `venta_caja`, `cuenta_transferencia_id` y `mp_credencial_id` se ignoran salvo que la llamada venga de un dispositivo de caja autenticado; corregir `mp.ts:256` (`const t = await conTokenFresco(...)`, usar `t.access_token`, tratar `!t.ok` como `inaccesible`) y revisar si el fail-open debe seguir existiendo.

### H-03 [CRITICA] XSS almacenado hacia la maquina de caja (HTML de comanda/ticket sin escapar, inyectado con document.write)
Archivos: `comprobantes/comanda/route.ts:57-68,111-121,137`, `comprobantes/ticket/route.ts:196,208,213,227` (y los items), `comprobantes/ticket-cuenta/route.ts:46-88`, receptor guardado desde `pedidos/estado/route.ts:96-110` y `mesa/cobrar/route.ts:108-117`, consumo en `components/operacion/VistaCaja.tsx:466-476,673`, sesion en `lib/supabase/client.ts:36-47`.
Escenario: el checkout publico acepta `datos_delivery.{nombre,direccion,entre_calles,telefono}` y los `nombre_*_snap` de los items como texto libre (`pedidos/route.ts:323-336` no los sanea; la RPC valida precio, no nombres). Un atacante crea un pedido con `direccion = <img src=x onerror=...>`. Cuando caja imprime la comanda, `imprimirHtml` hace `doc.write(html)` en un iframe about:blank (mismo origen) y el script corre en el origen de la app con acceso a `localStorage['coneos-auth']` (sesion de admin; el comentario de `operacion/consulta/route.ts:4-9` confirma que esas maquinas guardan una sesion de admin). Con ese token se llama a `/api/admin/*` y a PostgREST con RLS del admin (cambio de CBU de cobro, carga de cert/clave ARCA, compras y ordenes de pago).
`comprobantes/factura` si escapa (`esc`); las otras tres no.
Correccion propuesta: aplicar `esc()` a toda interpolacion de dato de usuario en las cuatro plantillas (extraerlo a un modulo comun); sanear/limitar longitud y caracteres de `datos_delivery`, `nombre_cliente`, `nombre_*_snap` al crear el pedido; renderizar el comprobante con `Content-Security-Policy` estricta o `iframe sandbox` sin `allow-scripts` (el script de impresion se inyecta desde el padre con `iframe.contentWindow.print()`); agregar cabeceras de seguridad globales (hoy `next.config.ts` no define `headers()`).

### H-04 [ALTA] "Autenticacion por dispositivo" que no autentica: volcado de PII y control de caja con un UUID publico
Archivos: `device/verify/route.ts:30-55`, `operacion/consulta/route.ts:12-21,42,67-77,122-135,149-161,214-217,248-288`, `operador/lista/route.ts:10-33`.
Escenario: `POST /api/device/verify {empresa_slug, sucursal_slug, tipo:'DELIVERY'}` (slugs publicos en la URL del comercio) devuelve el `id` del dispositivo. Con ese `id`, `POST /api/operacion/consulta {dispositivo_id, accion:'historial', fecha:'2026-10-01', verTodas:true}` devuelve todos los pedidos de la empresa de esa fecha con nombre, telefono y direccion, items, pagos y capturas (`:69-76`); iterando fechas se baja el historico completo. Con el mismo id un atacante pausa el delivery (`delivery_pausado_set`), apaga/prende la autoimpresion, y asigna cadetes pasando pedidos a READY (`asignar_cadete`). `operador/lista` entrega los nombres de operadores activos.
Correccion propuesta: reemplazar `dispositivo_id` por `device_token` (secreto, no listado) en estas dos rutas, quitar el modo 2 de `device/verify` o hacer que no devuelva `id`, exigir un token de sesion de operador para acciones de escritura, y acotar `historial` a un rango corto.

### H-05 [ALTA] Sin proteccion de fuerza bruta en PIN de operador y cadete
Archivos: `operador/login/route.ts:4-63`, `reparto/route.ts:151-168`.
Escenario: `operador/lista` da los `operador_id`; luego se prueban los 10.000 PIN de 4 digitos contra `operador/login` (o `reparto login` para cadetes: PIN exacto de 4 digitos, `reparto/[sucursal]/page.tsx:138`) sin limite: no hay rate limiting en todo el repo. Un login de cadete exitoso da un token de 14 dias (`reparto/route.ts:21,163`) con acceso a datos de entrega y posicion.
Correccion propuesta: contador de intentos por (operador/colaborador, IP) con bloqueo temporal en tabla o Upstash/Vercel KV; backoff exponencial; PIN de 6 digitos; invalidar tokens al cambiar PIN y ofrecer logout/revocacion; el login de operador debe emitir un token de sesion que las demas rutas verifiquen.

### H-06 [ALTA] Callback OAuth de Mercado Pago sin vinculo con el admin que inicio el flujo
Archivos: `mp/connect/route.ts:23-36`, `mp/callback/route.ts:18-58`, `lib/pagos/mp.ts:34-70`.
Escenario: `state` es base64 de `{empresa_id, slug, sucursal_id, mp_credencial_id}` sin firma, nonce ni sesion. Un atacante arma un state con el `empresa_id` de la victima, autoriza SU propia cuenta MP y el callback guarda sus tokens como credencial de esa empresa (`guardarCredencialOAuth` inserta una fila nueva, o actualiza si coincide `mp_user_id`). Hoy el resolver exige mapeo explicito (`pagos/resolver.ts:101-115`), por lo que la credencial no cobra por si sola; pero aparece en el panel de la victima como cuenta conectada (`activo:true`) y basta que un admin la asigne a un canal (o se confunda con la suya) para que los cobros vayan a la cuenta del atacante. Ademas la validacion de `sucursal_id` contra la empresa depende de las FK de la base.
Correccion propuesta: firmar `state` con HMAC (clave de servidor) que incluya empresa, usuario, expiracion y nonce; iniciar el flujo desde una ruta autenticada (`/api/mp/connect` con Bearer) y verificar en el callback la cookie/nonce de esa sesion; validar que `sucursal_id` pertenezca a la empresa.

### H-07 [ALTA] Politicas RLS abiertas `USING (true)` en arqueo de stock
Archivo: `supabase/versionado/01-stock-v1-v2-ddl.sql:208-210,237-239` (volcado del 2026-11-04; igual en `supabase/9b-arqueo-stock.sql:20-21`). El propio volcado lo marca como "policy abierta para todos los roles".
Escenario: con la anon key publica, `GET/PATCH/DELETE /rest/v1/arqueos_stock` y `/arqueo_items` leen y modifican los arqueos de TODOS los comercios. Como `confirmar_arqueo_stock` aplica diferencias a `producto_stock`, falsear `arqueo_items.fisico` altera stock real.
Correccion propuesta: reemplazar por policies `empresa_id = auth_empresa_id()` (como `producto_stock`) y revocar acceso anon a esas tablas.

### H-08 [ALTA] Ruta de beneficios: robo de puntos y enumeracion de clientes
Archivo: `beneficios/route.ts:7-31,35-73,78-103`.
Escenario: `PUT {pedido_id, telefono:<victima>, opcion_ids}`: se descuenta saldo del telefono de cualquier cliente (basta un pedido propio y el numero de la victima) y no se aplica ningun descuento al pedido, se pierde el saldo. El costo se calcula con `opciones` sin filtrar por empresa (`:51-52`) y sin idempotencia ni lock (`:62-70`: dos PUT en paralelo cobran 2 veces o dejan saldo negativo). `GET ?empresa_id&telefono` confirma si un telefono es cliente y su saldo.
Correccion propuesta: acreditar y canjear solo desde un contexto con identidad (dispositivo/operador) o con un OTP al telefono; pasar el canje por una RPC atomica con `SELECT ... FOR UPDATE`, unicidad por (pedido, canje) y filtro de empresa en `opciones`.

### H-09 [ALTA] Destruccion y manipulacion de pedidos ajenos
Archivos: `pedidos/eliminar/route.ts:7-99`, `pedidos/comprobante/route.ts:11-71`.
Escenario: `POST /api/pedidos/eliminar {pedido_id}` borra cualquier pedido no cobrado con sus items y revierte stock y puntos; el `pedido_id` se obtiene de otras rutas (H-01, `pedidos/estado` GET). `POST /api/pedidos/comprobante` permite pisar la captura de transferencia de otro pedido (`upsert:true`, `:34-38`) o la nota de comprobante (`:62-68`), borrando evidencia de pago.
Correccion propuesta: ambas con identidad de dispositivo/operador; en `comprobante`, solo permitir la subida al creador del pedido (token de pedido firmado devuelto en `POST /api/pedidos`), validar tipo MIME/magic bytes (jpeg/png/webp), forzar `contentType` y extension del servidor, no usar `upsert`.

### H-10 [MEDIA] `empresaDelAdmin` por `limit(1)` sin filtro ni orden, y ausencia de chequeo de rol en endpoints financieros
Archivos: `admin/cuits/route.ts:31-34`, `admin/pagos-cuentas/route.ts:46-49`, `catalogo/canal/route.ts:131-134`, `compras/route.ts:29-32`.
Escenario: la empresa se obtiene de `empresas.select('id').limit(1)` bajo RLS. Si la policy de `empresas` deja ver mas de una fila a algun usuario autenticado (SUPER_ADMIN, o si existe una policy de lectura publica para el kiosk), el resultado depende del orden fisico y las escrituras server-side con service_role van a una empresa equivocada. Ademas ninguna de estas rutas consulta `auth_rol()` (`supabase/versionado/05-funciones-trigger-y-auth.sql`): un `ADMIN_SUCURSAL` podria cargar certificados ARCA o registrar ordenes de pago de toda la empresa. La policy de `empresas` no esta en el repo: no verificable.
Correccion propuesta: obtener la empresa desde `usuarios_admin.empresa_id` con `auth.uid()` (el patron de `useEmpresa.ts:53-57`), validar el JWT con `supabase.auth.getUser(token)` y exigir `auth_rol() in ('ADMIN_EMPRESA','SUPER_ADMIN')` en cuits y compras.

### H-11 [MEDIA] Webhook de Mercado Pago: sin firma, sin comparar monto y con amplificacion
Archivos: `mp/webhook/route.ts:20-74`, `lib/pagos/mp.ts:173-216`.
Mitigado por la consulta del pago a MP con la credencial y por exigir pedido de la empresa de la credencial. Falta: verificar `x-signature` (secreto de la app MP), comparar `transaction_amount` y `currency_id` con `pedido.total`, y evitar el barrido de todas las credenciales (`mp.ts:213-215`) para llamadas sin `?c=`: un atacante dispara decenas de requests salientes a MP por cada POST (agotamiento de cuota/rate limit de MP de los clientes). `payment.id` se interpola sin `encodeURIComponent` en la URL a MP (`:38`; riesgo bajo, la URL base es fija).
Correccion propuesta: validar firma HMAC de MP; comparar monto; eliminar el barrido (preferencias sin firma ya vencieron) o limitarlo y registrar.

### H-12 [MEDIA] Lecturas anonimas de datos personales y de negocio por UUID o `empresa_id`
Archivos: `pedidos/estado/route.ts:12-25`, `reparto/route.ts:75-116,173-195`, `comprobantes/*`, `visitas/resumen/route.ts:16-101`, `mp/estado/route.ts`, `facturacion/emitir/route.ts:19-38`.
Detalle: los UUID de pedido son inadivinables pero se enumeran por H-01 (`facturacion/nc` GET); con ellos se obtiene nombre, telefono, direccion, items y datos fiscales. `visitas/resumen` entrega analitica y direcciones de entrega agregadas de cualquier empresa. `reparto cliente_posicion` entrega ubicacion en vivo del cadete por UUID de pedido. Correccion: ligar el acceso del cliente a un token de pedido (firmado, devuelto al crear el pedido) en lugar del UUID crudo; mover `visitas/resumen` a Bearer admin; no exponer listados de ids.

### H-13 [MEDIA] Errores y diagnosticos que filtran detalle interno
Citas: `pedidos/route.ts:28` (respuesta `debug` con ids), `pedidos/route.ts:434`, `mesa/cobrar/route.ts:150`, `pedidos/comprobante/route.ts:38,43,69` (`Storage: ${upErr.message}`), `facturacion/emitir/route.ts:50`, `pedidos/eliminar/route.ts:96`, `catalogo/canal/route.ts:73`, `compras/route.ts:121,482,630,675,689,703` (hasta 160 caracteres de mensaje de Postgres). `mp/callback/route.ts:44` imprime en logs la respuesta de MP al fallar el canje de tokens (puede incluir detalle de cuenta; no se vio impresion de tokens). La Edge Function imprime en logs hasta 600 caracteres de la respuesta WSAA (`index.ts:222`) y 500 de cada respuesta ARCA (`:251`). Correccion: mapear errores a mensajes genericos con un codigo, loguear el detalle solo en servidor.

### H-14 [MEDIA] Sin cabeceras de seguridad, CSP ni SRI; build sin controles
Archivos: `next.config.ts:4-9` (sin `headers()`; `typescript.ignoreBuildErrors`, `eslint.ignoreDuringBuilds`), `comprobantes/ticket/route.ts` y `factura/route.ts:132` (script de `cdnjs.cloudflare.com/.../qrcode.min.js` sin `integrity`). Un fallo en ese CDN ejecuta JavaScript en el origen de la app. Correccion: CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, SRI en los scripts externos (o empaquetar la libreria), y reactivar el chequeo de tipos en CI (el bug de `mp.ts:256` es el tipo de error que ese chequeo detecta).

### H-15 [BAJA] Otros
- `mp/preferencia/route.ts:45`: el regex de origen permitido acepta `coneos-*.vercel.app`; cualquiera puede registrar un proyecto con ese prefijo y recibir al cliente tras pagar. Usar lista explicita de dominios.
- `pwa-manifest/route.ts:9,12`: `path` sin validar en `start_url`.
- `dispositivos/latido/route.ts:12-21` y `visitas/route.ts:35-69`: escrituras anonimas con `empresa_id` arbitrario.
- `.env.local` existe en el arbol de trabajo (no versionado: `git ls-files` no lo lista y `git log --all -- .env.local` esta vacio). Variables definidas (solo nombres): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `PIN_SALT_ROUNDS` (esta ultima sin uso en `src/`). El codigo ademas usa `MP_CLIENT_ID` y `MP_CLIENT_SECRET` (no estan en `.env.local`, presumiblemente en Vercel). Ninguna variable con prefijo `NEXT_PUBLIC_` contiene un secreto: la service role no esta expuesta al bundle.
- No hay secretos hardcodeados: el unico patron detectado fuera de `.env.local` es un placeholder de texto `-----BEGIN PRIVATE KEY-----` en `src/app/[empresa]/admin/cuentas/page.tsx:539`. Archivos vacios versionados en la raiz (`findstr`, `git`, `n.toString().padStart(2`) y `rpc-refs.txt` son ruido; conviene quitarlos.
- `dangerouslySetInnerHTML` aparece una vez (`src/app/layout.tsx:22`) con script estatico que solo usa `encodeURIComponent`: sin hallazgo.
- Uso de Storage desde el cliente (`admin/accesorios`, `admin/catalogo`, `admin/config`, bucket `productos` y `logos`) y desde `pedidos/comprobante` (bucket `capturas`). Las policies de los buckets no estan en el repo; si `productos`/`logos` permiten escritura anon o cross-tenant no se pudo comprobar.

## 5. Lo que esta bien hecho

- Rutas admin: empresa derivada de la sesion y filtros `.eq('empresa_id')` en cada UPDATE/SELECT, `count: 'exact'` para detectar 0 filas (`pagos-cuentas`, `cuits`, `compras`).
- Cert y clave privada ARCA son write-only: el GET devuelve booleanos (`cuits/route.ts:49-52`).
- `crear_pedido_stock` es server-authoritative de precio, opciones, promos y sucursal∈empresa (`supabase/versionado/crear_pedido_stock.vivo-2026-11-04.sql`).
- `reparto`: validacion de sesion en cada accion privada, idempotencia de `entregar`, UUID como llave publica de pedido.
- `mp/webhook`: consulta el pago real a MP y exige que el pedido sea de la empresa de la credencial; transicion idempotente.
- `kiosk/pagos` no devuelve credenciales MP.

## 6. Lo que no pude verificar

- Policies RLS vivas de `empresas`, `pedidos`, `facturacion_config`, `mp_credenciales`, `dispositivos`, `operadores`, `usuarios_admin`, buckets de Storage: solo existe en el repo el volcado parcial `supabase/versionado/*` (stock/compras) y migraciones sueltas. Es decisivo para H-10 y para saber que alcanza un admin autenticado directo por PostgREST.
- Si `arca-facturar` esta desplegada con `verify_jwt` activo (no hay `config.toml`; H-01). Tampoco si el repo local coincide con la version desplegada.
- Los RPC `verificar_pin_operador`, `registrar_orden_pago`, `aplicar_credito_op`, `registrar_factura_compra`, `ingresar_remito_stock`, `ajustar_stock`, `anular_orden_pago`, etc.: no estan en el repo (solo `crear_pedido_stock` y las funciones de `05-funciones-trigger-y-auth.sql`). No se sabe si validan pertenencia a la empresa ni si tienen `GRANT EXECUTE` a `anon`: si lo tienen, cualquiera podria llamarlos directo por `/rest/v1/rpc/...` con la anon key.
- Los hallazgos H-02 a H-09 son por lectura de codigo; no se ejecuto ninguna peticion contra el sistema.
- Politica real de longitud de PIN en base (la UI usa 4 digitos para cadete y 4-6 para operador) y valor de `PIN_SALT_ROUNDS`.
- Configuracion de Vercel (Firewall/WAF, rate limits de plataforma, variables de entorno de produccion, `MP_CLIENT_SECRET`).
- Contenido de `para-fable.tar` (archivo en el arbol de trabajo, no versionado; no se abrio).
- Paginas del lado cliente que escriben con el cliente anon (98 llamadas `insert/update/delete/upsert` en `src/app` y `src/components`): su seguridad depende por entero de RLS, no auditada aqui.
