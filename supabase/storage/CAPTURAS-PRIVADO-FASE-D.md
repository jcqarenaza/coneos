# Fase D — Privatizar el bucket `capturas` (PREPARACIÓN, nada aplicado)

Estado: SQL endurecido y probado en un Postgres local descartable. **No se ejecutó nada en cones-prod.** Commit, push y deploy NO autorizados. La privatización espera la decisión del CTO.

## 1. Qué cambia (80/20)

| Cambio | Detalle |
|---|---|
| Bucket `capturas` | `public = false` (una sola fila, un solo campo) |
| Policy | se elimina SOLO `"Allow public read from capturas"` en `storage.objects` |
| No se toca | otros buckets, las otras 11 policies, `storage_admin_*`, `storage_empresa_*`, objetos (incluidos los 81 en cuarentena), pedidos |

## 2. Estado auditado que el SQL exige (listado real de `pg_policies`, cones-prod)

`storage.objects` tiene **12** policies (corrige el "13" de la Fase 1: ese número fue un error de conteo mío; el listado directo del 19/11 da 12). RLS activo.

| # | Policy | Rol | Comando | Alcance |
|---|---|---|---|---|
| 1 | **Allow public read from capturas** | public | SELECT | `capturas` — **la única que se elimina** |
| 2 | Allow read logos | public | SELECT | `productos` (el nombre engaña) |
| 3 | Allow read logos bucket | public | SELECT | `logos` |
| 4 | Allow read logos pwa | public | SELECT | `logos` |
| 5 | public_read_productos | public | SELECT | `productos` |
| 6–8 | storage_admin_delete / insert / update | authenticated | DELETE / INSERT / UPDATE | `productos`, `logos`, `assets` |
| 9–12 | storage_empresa_delete / insert / select / update | authenticated | DELETE / INSERT / SELECT / UPDATE | los mismos 3 buckets + `storage_admin_puede(...)` |

Después de aplicar quedan 11 (las filas 2–12), idénticas. Ninguna alcanza `capturas`: solo el `service_role` (A1) podrá leerlo.

## 3. Archivos y orden de ejecución (Supabase SQL Editor, cones-prod)

| # | Archivo | Qué hace | Escribe |
|---|---|---|---|
| 1 | `supabase/storage/capturas-privado-00-precheck.sql` | Exige el estado exacto auditado. Termina en `PRECHECK OK` | No (ni bloqueos) |
| 2 | `supabase/storage/capturas-privado-01-aplicar.sql` | Una transacción: bloquea, **vuelve a exigir el estado exacto**, privatiza, elimina la policy, exige el estado final y compara la huella | Sí |
| 3 | `supabase/storage/capturas-privado-02-postcheck.sql` | Exige el estado final exacto. Termina en `POSTCHECK OK` | No (ni bloqueos) |
| — | `supabase/storage/capturas-privado-REVERSION-NO-EJECUTAR.sql` | Rollback exacto, solo con orden del CTO | Sí |

Hashes SHA-256 de los SQL (los del resto de los archivos están en el informe de entrega):

```
b281e3b82f639c235e39510206f88962c12dc18a5775c1eb8fcab70e804d7b09  capturas-privado-00-precheck.sql
23f97abd6a6dbbed2df2fe90f382a1dc36f932b50a6f32a82e13947a912b43de  capturas-privado-01-aplicar.sql
f3cd8254655247450dd6115b3f3ee0207e68c666d24dbac741d7fba124ede87e  capturas-privado-02-postcheck.sql
acdd050ee702093c23e814da1c7265514f3d7d7ddf40224ed9ea09694a1c0b73  capturas-privado-REVERSION-NO-EJECUTAR.sql
```

Antes de ejecutar: `sha256sum` de cada archivo y comparar. Orden: 00 → 01 → 02, un archivo por vez. **Las tres últimas columnas del resultado final** (`huella_otros_buckets`, `huella_otras_11_policies`, `objetos_total`) deben ser IGUALES en 00, 01 y 02: así se comprueba que no cambió nada más. Si 01 falla, no hay que revertir: la transacción no se aplicó.

Precondiciones: `main` con A1 y A2 (ya está). Nada exige la Fase C. Sin soporte PDF: los comprobantes son imágenes (decisión CTO 20/11, ver §10).

## 4. Controles y por qué impiden ejecutar sobre un estado distinto del auditado

| Control | Falla ante | Por qué importa |
|---|---|---|
| Las 12 policies exactas (nombre, rol, comando, permissive/restrictive, USING, WITH CHECK) | una policy **adicional** (abierta, restrictiva, para public, anon o authenticated, nombre o no `capturas`), **ausente**, **renombrada** o con definición **alterada** | La seguridad del bucket privado depende de que no exista otro camino de lectura. Una policy `using (true)` no menciona `capturas` y el chequeo anterior (buscar la palabra) no la veía: la comparación exacta sí |
| Aplica la misma verificación **dentro** de la transacción, tras tomar los bloqueos | que algo cambie entre el precheck y el aplicar, o que alguien salte el precheck | El precheck no es lo único que protege; el estado verificado es el que se modifica |
| Bloqueo `ACCESS EXCLUSIVE` sobre `storage.objects` y `SHARE ROW EXCLUSIVE` sobre `storage.buckets`, `lock_timeout` 5 s | otra sesión modificando policies o buckets | Nadie puede alterar policies entre la verificación y el cambio. Si no se consigue el bloqueo en 5 s, aborta sin cambios. Efecto: las consultas a Storage esperan unos milisegundos (el `DROP POLICY` pide ese mismo bloqueo igual) |
| RLS activo en `storage.objects` | RLS desactivado | Sin RLS las policies auditadas no serían la barrera |
| Bucket `capturas`: público, STANDARD, 10 MB, MIME jpeg/png/webp/pdf (la lista MIME del bucket NO se toca: el SQL no la cambia aunque la aplicación ya no sube PDF) | cualquier atributo distinto | Es el estado que se auditó; otro estado no se conoce |
| `assets`, `logos`, `productos` existen y son públicos | ausentes o privados | Mismo motivo; además el cambio no debe afectarlos |
| Estado final exacto (11 policies, `capturas` privado con atributos intactos) y huella de lo que no se toca | cualquier efecto colateral (trigger, otra policy, otro bucket, objetos) | Rollback automático de toda la transacción |
| Doble aplicación | segunda corrida: "capturas ya NO es público" | Aborta explícitamente y no cambia nada |
| Reversión | estado posterior distinto del esperado (policy nueva, alterada, ausente, bucket ajeno) **antes** de tocar; y estado de la auditoría exacto **después** | No restaura sobre un estado desconocido y no deja una reversión a medias |

## 5. Rollback

Ejecutar `capturas-privado-REVERSION-NO-EJECUTAR.sql` (misma estructura: bloqueos → exige el estado posterior exacto → restaura `public = true` y recrea la policy con la definición original `for select to public using (bucket_id = 'capturas')` → exige las 12 exactas → compara huella). Luego correr el precheck: debe volver a dar `PRECHECK OK`. Único efecto no recuperable: el `updated_at` del bucket. Las URLs públicas viejas vuelven a funcionar (salvo el cache, ver §8).

## 6. Qué sigue funcionando con el bucket privado (A1/A2)

| Operación | Estado | Por qué |
|---|---|---|
| Ver comprobante en Caja (`captura_url`) | Funciona | Firma server-side con `service_role` (ignora policies), 600 s |
| Listado de Caja / pedidos_hoy | Funciona | Solo expone `tiene_captura`, nunca la URL |
| Comprobantes viejos (URL pública guardada) | Funcionan | A1 extrae la ruta y firma; no hace falta migrarlos |
| Subir comprobante (A2) | Funciona | Escritura server-side con `service_role` |
| Cliente anónimo leyendo `capturas` directo | **Deja de funcionar** | Ya no hay policy de lectura ni bucket público |
| Otros buckets y uploaders legacy | Sin cambios | No se tocan |

## 7. Verificación posterior (solo con autorización de aplicar)

- **URL firmada funciona:** en /cecchetto o /federal, abrir un pedido con comprobante en Caja; se ve la imagen del comprobante (URL firmada). Sin crear pedidos.
- **URL pública deja de funcionar:** `GET /storage/v1/object/public/capturas/<ruta existente>` esperado 4xx, no 200. Registrar status y headers (`cf-cache-status`, `age`). No usar objetos en cuarentena.

## 8. CDN y cache residual

Hipótesis a confirmar con evidencia (no verificado en producción):
- una respuesta ya cacheada puede seguir sirviéndose hasta que venza su TTL (`cache-control: max-age`), aunque el bucket sea privado;
- una ruta nunca cacheada, o con el cache vencido, debe dar error enseguida;
- cache residual = 200 con `cf-cache-status: HIT` y `age` > 0 después de aplicar; bloqueo efectivo = 4xx con `MISS` o `DYNAMIC`;
- considerar "cerrado" pasado el TTL máximo observado. Si se necesita cierre inmediato, queda como riesgo aceptado o requiere invalidación (a evaluar; no se hizo nada).

## 9. Comprobantes viejos sin migrarlos

No se copian ni mueven objetos ni se modifica `pedidos.captura_transferencia_url`. A1 deriva la ruta (`pedidos/<id>.<ext>` o `<empresa_id>/pedidos/<id>.<ext>`), valida empresa/sucursal y firma. La Fase C queda como mejora de orden, no como requisito. Los 81 objetos en cuarentena no se enumeran ni tocan.

## 10. PDF: fuera de alcance (decisión CTO 20/11)

ConeOS trabaja con comprobantes en **imagen** (JPG, JPEG, PNG, WebP). No hay visor PDF, ni PDF.js, ni paginado, ni enlaces externos.
- **API:** `POST /api/pedidos/comprobante` rechaza el PDF (415 `FORMATO`) mirando el contenido real del archivo, sin importar nombre ni tipo declarado.
- **Navegador (delivery/takeaway):** el selector ofrece solo `image/jpeg, image/png, image/webp` y `validarCapturaCliente` (misma detección por contenido) rechaza un PDF con un mensaje antes de subirlo.
- **Vista Caja:** imagen directa con URL firmada de 10 minutos (renovable con "Reintentar"), igual que antes de esta fase.
- **Respuesta de Caja (`captura_url`):** incluye `tipo`, derivado por el SERVIDOR de la ruta ya validada (nunca del cliente): `{ url, expira_en_seg: 600, tipo: 'imagen' }` para imágenes y `{ tipo: 'pdf_archivado' }` (sin URL) para una ruta `.pdf`.

### Caso histórico: un PDF existente en `capturas` (decisión CTO 20/11: indicador + texto, nada más)
Auditoría de solo lectura (20/11): **un** objeto PDF, `pedidos/d913e6f9-3581-4e50-a228-5be616de8d97.pdf` (112.356 bytes, 04/10/2026), asociado al pedido **#39** (`d913e6f9-…`, DELIVERED, DELIVERY) de la empresa `federal`, sucursal `federal`. El pedido guarda la URL pública completa en `captura_transferencia_url`; ningún otro pedido ni objeto es PDF.
- **Qué muestra Vista Caja:** «Comprobante PDF archivado; no disponible para visualización». Solo texto: no se renderiza como imagen, no hay enlace, visor ni descarga.
- **Cómo:** `consultarCaptura` (storage.ts) valida pedido + empresa + ruta y, si la ruta termina en `.pdf`, responde `pdf_archivado` **antes** de pedir ninguna firma a Storage. `firmarCaptura` y `firmarCapturasDePedidos` tampoco firman nunca un PDF. `tiene_captura` sigue en `true` (el pedido tiene comprobante) y el alcance por empresa y sucursal no cambia.
- **Qué NO se hace:** no se descarga, convierte, mueve ni borra el objeto; no se modifica el pedido; sin SQL ni cambios en Storage. Con el bucket privado el objeto queda protegido y solo se accede con `service_role` (panel de Supabase) o con una URL firmada que genere un administrador a pedido.
- **Si algún día se necesita verlo:** convertirlo a imagen fuera de la aplicación, como acción manual con autorización explícita, conservando el original.

## 11. Pruebas

| Suite | Resultado |
|---|---|
| comprobante-caja, comprobante-cliente, storage, captura-url-ruta, comprobante-subida (sin PDF: se rechaza en navegador y API; PDF histórico = «archivado», sin firma; imágenes siguen) | 68/68 |
| capturas-privado-sql (Postgres 16 local) | 99/99 |

La suite SQL cubre: el esquema de prueba reproduce el texto exacto del listado real; las 12 policies exactas; 28 desvíos (adicional abierta / para anon / para authenticated / ALL / sin nombrar capturas / restrictiva, renombrada, USING / WITH CHECK / rol / permissive / comando alterados, ausente, RLS apagado, atributos y buckets distintos) contra **precheck y aplicar**; 10 estados posteriores desviados contra **postcheck y reversión**; doble aplicación; bloqueo con `lock_timeout`; 4 pruebas de atomicidad en aplicar y 1 en reversión; ciclo aplicar → revertir → aplicar; huellas iguales entre scripts; pruebas estáticas (solo los cambios autorizados, orden bloqueo → verificación → cambio, precheck/postcheck sin escritura). Se verificó con una mutación deliberada (quitar el WITH CHECK de la comparación y el bloqueo) que los tests la detectan.

## 12. Límites honestos

- Probado sobre un esquema `storage` simulado (PostgreSQL 16; la real es 17.6), no sobre Supabase. El precheck contra producción es la verificación definitiva. El texto de USING/WITH CHECK se compara tal como lo devuelve `pg_policies`; si en producción difiriera por versión, el precheck aborta (falla segura).
- No verifiqué que el rol del SQL Editor tenga privilegio para `LOCK TABLE` sobre `storage.objects`; si no lo tuviera, el script aborta antes de cambiar nada. Hay precedente de `DROP`/`CREATE POLICY` en este proyecto desde el SQL Editor (`seguridad-general-correccion.sql`).
- El precheck supone RLS activo en `storage.objects` (así figura en la auditoría anterior); si no lo está, aborta.
- Los atributos de los buckets `assets`, `logos` y `productos` (además de que existan y sean públicos) se comprueban con las huellas md5 de la última fila, comparadas a mano entre 00, 01 y 02.
- No se verificó el cuerpo de `storage_admin_puede` (solo afecta a policies sobre `productos`, `logos` y `assets`).

## 13. Fuera de alcance (fases separadas)

`storage_admin_*` y refactor de los 5 uploaders legacy, Fase C, Fase E, objetos en cuarentena.
