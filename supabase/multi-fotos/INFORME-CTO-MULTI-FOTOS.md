# MULTI-FOTOS — Informe para GO del CTO

07/11/2026 (corrección final por decisión CTO) · Rama `feature/multi-fotos` (desde `main` 887fca5) · Juan Cruz Quarleri (revisión técnica: Fable)

**Estado:** preparado y probado en entornos aislados. **No se ejecutó nada en la base compartida, no hay merge ni deploy.** Falta tu GO específico.

## 1. Veredicto (el 80%)

Listo para GO, con 3 cosas a decidir (sección 6). Qué hace:
- Hasta **10 fotos por producto y 10 por presentación**, una principal, reordenables.
- Si una presentación no tiene fotos propias, **hereda las del producto**.
- Grilla = solo la principal. Detalle = carrusel (kiosk, delivery, mesa y take away, un solo componente).
- `imagen_url` se mantiene como espejo de la principal: **los 17 usos actuales no se tocan**.
- El código funciona **antes o después** del SQL (si la tabla no existe, el admin muestra el cargador clásico y el catálogo responde como hoy). Se puede desplegar en cualquier orden.

| Prueba | Resultado |
|---|---|
| Integridad, seguridad, concurrencia (PostgreSQL 16 aislado) | **30/30**, y 15 corridas de estrés sin fallas |
| Migración + reversión con respaldos acumulativos + re-aplicación + mutaciones de la verificación | **59/59** |
| API `/api/kiosk/catalogo` (herencia, fallback, paginación) | **14/14** |
| Interfaz en navegador real (galería admin + carrusel) | **22/22** |
| `next build` | **No pudo correrse** en mi entorno (sin acceso a Google Fonts): lo valida el preview de Vercel |

Evidencia completa: `supabase/multi-fotos/tests/evidencia-multi-fotos.txt`.

## 2. Qué corregí respecto de la propuesta anterior (hallazgos de la revisión)

| # | Problema de la propuesta | Corrección |
|---|---|---|
| 1 | Sin integridad empresa↔producto↔presentación | FK compuesta `(producto_id, empresa_id)` (usa el `UNIQUE(id, empresa_id)` que ya existe) + validación de presentación en trigger |
| 2 | `SECURITY DEFINER` en el espejo de `imagen_url` | **Todas las funciones son `SECURITY INVOKER`** (bajo RLS), `search_path` fijo, sin EXECUTE para anon/authenticated en triggers: no elevan privilegios |
| 3 | Sync solo contemplaba cambios simples | INSERT/UPDATE/DELETE, cascadas de producto y presentación, promoción automática si se borra la principal, sin updates innecesarios |
| 4 | "Una sola principal" solo por convención | Índice único parcial + trigger: la primera foto es principal; marcar otra la mueve **en el mismo statement** (atómico) |
| 5 | Sin límite en servidor | Máximo 10 por ámbito validado en trigger, con lock (12 altas simultáneas → exactamente 10) |
| 6 | Dueño de la foto modificable | Producto, presentación y empresa **inmutables** una vez creada la foto |
| 7 | URL sin validar | Solo `http(s)://`, 10–2048 caracteres |
| 8 | **Deadlock real** (lo encontré probando): editar un producto mientras alguien toca sus fotos | Orden fijo de locks (padre → catálogo) + lock de statement que serializa solo las escrituras de fotos. 15 corridas de estrés sin fallas |
| 9 | Reversión que perdía las fotos extra / podía pisar respaldos | **Respaldos acumulativos**: cada ejecución crea una captura con UUID y fecha (`producto_imagenes_respaldo` + `_log`), nunca borra las anteriores, **verifica filas y contenido (en ambos sentidos) antes de borrar** y aborta todo si difiere. Tablas de respaldo **sin acceso para anon, authenticated ni service_role**, con RLS. `imagen_url` conserva la principal vigente |
| 10 | Verificación de migración solo cubría productos | Ahora compara **productos Y presentaciones** contra su foto principal (en ambos sentidos), cantidades y una principal por ámbito; **cualquier diferencia aborta toda la transacción** (probado con 4 mutaciones) |

## 2b. `bump_catalogo_empresa` (reversión) — definición real y decisión

Firma y definición reales (catálogo, 07/11): `public.bump_catalogo_empresa(p_empresa uuid) RETURNS void`, `plpgsql SECURITY DEFINER SET search_path TO 'public'`: suma 1 a `catalogo_version.version` de la empresa y siembra las filas que falten para sus sucursales (`on conflict do nothing`). Es la misma función que hoy dispara, por cada fila, el trigger `bump_catalogo` de productos y presentaciones.
- **Seguro:** solo incrementa un contador y siembra filas faltantes; no lee ni expone datos.
- **Necesario:** kiosk, delivery, mesa y take away detectan cambios por esa versión; sin refresco, un cliente abierto seguiría mostrando el carrusel viejo hasta recargar.
- **Ajuste:** el refresco de **todas** las empresas era seguro pero innecesario. Ahora solo se refrescan las empresas que **tenían fotos** (las demás no cambian de contenido). Probado: empresas con fotos refrescadas, empresa sin fotos intacta, en las dos reversiones.

## 3. Dependencias del esquema real (verificado por SELECT al catálogo, 07/11)

- `productos`: `UNIQUE(id, empresa_id)` ya existe → FK compuesta posible sin tocar `productos`. `presentaciones`: no lo tiene; se valida por trigger (no se modifica ninguna tabla existente).
- RLS: `admin_productos` / `admin_presentaciones` por `empresa_id = auth_empresa_id()`. La tabla nueva usa el mismo patrón. **Sin lectura anon**: el catálogo público sale por la API (service_role), igual que hoy.
- `trg_bump_catalogo()` toma `empresa_id` (no hay `sucursal_id` en estas tablas) → refresca el catálogo de toda la empresa. Se reutiliza el mismo trigger.
- Triggers existentes en `productos` y `presentaciones`: solo `bump_catalogo`. Compatibles (se probó que siguen intactos tras aplicar y tras revertir).
- Datos actuales: 122 productos (18 con foto, 1 borrado con foto) y 198 presentaciones (109 con foto). Todas las URLs son de Storage del propio proyecto. La migración las copia como principales (esperado: 18 + 109 = **127 filas**; el SQL compara contra el origen y aborta toda la transacción si no cuadra).
- Storage SEG-3 verificado, **sin modificar**: `storage_admin_insert/update/delete` TO authenticated sobre `productos`/`logos`/`assets`; bucket `productos` 10 MB, JPEG/PNG/WEBP/GIF/ICO. La galería sube a `galeria/<producto>/<uuid>.<ext>` con `upsert:false`.
- Stock V2: sin interacción. No toca `producto_stock`, ni compras, ni el bump diferido propuesto. Si ese bump pasa a diferido, el orden de locks de multi-fotos se mantiene válido.

## 4. Riesgos detectados

| Sev. | Riesgo | Mitigación / decisión |
|---|---|---|
| **Media** | Las policies de Storage de SEG-3 son **por bucket, no por empresa**: un admin de un comercio podría sobrescribir/borrar fotos de otro comercio si conoce la ruta. Ya existía antes de multi-fotos. | **No lo modifiqué.** La galería usa rutas con UUID y no sobrescribe. Recomiendo un frente aparte: prefijo `empresa_id/` + policy por prefijo (requiere GO) |
| Baja | Escritura directa a `imagen_url` desde un admin viejo en caché (antes del deploy): quedaría distinta de la galería | El catálogo usa la galería si tiene filas; el único escritor actual es `admin/catalogo/page.tsx` (las pestañas `ProductosTab`/`PresentacionesTab` no se importan en ningún lado) |
| Baja | Las fotos quitadas **no se borran de Storage** (quedan huérfanas) | Igual que hoy al reemplazar una imagen. Limpieza futura, aparte |
| Baja | Un lock global serializa las escrituras de fotos (todas las empresas) | Son tareas de admin de milisegundos; las ediciones normales del catálogo **no** lo toman |
| Baja | Borrado físico de un producto en el mismo instante en que se editan sus fotos podría abortar una de las dos operaciones | Hoy el borrado es lógico (`deleted_at`); caso teórico |
| Baja | El admin con rol SUPER_ADMIN de otra empresa no gestiona fotos ajenas | Igual que `productos` hoy |
| Info | HEIC no está permitido por el bucket (iPhone suele convertir a JPEG al elegir) | Mensaje claro en la galería |
| Info | `database.types.ts` está desactualizado (ya hoy da 1085 errores de tipos, ocultos por `ignoreBuildErrors`) | Regenerar tipos tras el SQL |
| Info | Operación (`NuevoPedido`) y beneficios usan solo la principal | Por diseño de esta etapa |

## 5. Archivos (rama `feature/multi-fotos`)

| Ruta en el repo | Estado |
|---|---|
| `supabase/multi-fotos/01-multi-fotos-correccion.sql` | nuevo — **correr a mano en SQL Editor, solo con GO** |
| `supabase/multi-fotos/02-multi-fotos-reversion.sql` | nuevo |
| `supabase/multi-fotos/INFORME-CTO-MULTI-FOTOS.md` | nuevo (este archivo) |
| `supabase/multi-fotos/tests/` (README, 00-base-sintetica.sql, run-all.sh, test-integridad.py, test-migracion-reversion.sh, test-api-catalogo.ts, test-ui-galeria.js, fake-supabase.js, harness-galeria.page.tsx.txt, evidencia-multi-fotos.txt) | nuevo |
| `src/lib/imagenes.ts` | nuevo — constante `MAX_IMAGENES`, orden y compat |
| `src/components/admin/GaleriaImagenes.tsx` | nuevo — galería del admin |
| `src/components/kiosk/GaleriaCarrusel.tsx` | nuevo — carrusel |
| `src/app/api/kiosk/catalogo/route.ts` | modificado — agrega `imagenes` (aditivo) |
| `src/components/kiosk/KioskCatalogo.tsx` | modificado — insignia 📷 N y carrusel (kiosk/delivery/mesa/take away) |
| `src/app/[empresa]/admin/catalogo/page.tsx` | modificado — usa la galería en producto y presentación |

## 6. Decisiones para tu GO

1. **GO para el SQL** `01`: crea la tabla, 2 índices, 1 policy, 4 funciones de trigger, 2 RPC y 5 triggers; copia 127 fotos; no modifica nada existente. Corre en una sola transacción y se autoverifica (aborta si la migración no cuadra con el origen).
2. **Orden de salida:** es indistinto. El SQL es aditivo y el código funciona con o sin la tabla. Sugerido: SQL, luego deploy del código, luego prueba en el LAB.
3. **Storage por empresa** (riesgo Media de arriba): ¿lo abrimos como frente aparte?

## 6b. Huellas SHA-256 de los SQL entregados

```
8f1daf2117049dbb68f0077e6e3680f1060ab2aef6799086d9f7da1a43a2bfb2  01-multi-fotos-correccion.sql
669131ef37c8a671430d00fa3af7b2dc20b8106e6cfb00186cd47318ef802864  02-multi-fotos-reversion.sql
```

Verificar en la PC antes de correr: `certutil -hashfile supabase\multi-fotos\01-multi-fotos-correccion.sql SHA256` (idem el 02).

## 7. Qué NO está probado

- El SQL **no se corrió en la base real**: se probó en un PostgreSQL 16 aislado con una réplica mínima del esquema (columnas, constraints, RLS, triggers y funciones verificados por catálogo). Otras tablas/vistas que dependan de `productos`/`presentaciones` no se ejercitaron.
- Flujo completo en el LAB real (requiere el SQL aplicado, o sea tu GO).
- `next build` (ver arriba).
