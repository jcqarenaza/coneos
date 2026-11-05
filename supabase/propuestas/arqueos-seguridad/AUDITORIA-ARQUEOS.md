# Auditoría de seguridad de arqueos — incidente separado

4/11/2026 · Orden CTO punto 3 · Juan Cruz / Fable
**Estado:** auditoría y propuesta. No se ejecutó SQL en el Supabase compartido (ni lecturas); todo sale de los volcados versionados y de un Postgres local aislado.

## 1. Resultado en cinco líneas

1. **Crítico:** `arqueos_stock` y `arqueo_items` tienen policies `USING (true) WITH CHECK (true)` para todos los roles y `GRANT ALL` a `anon`. La anon key viaja en el navegador: cualquiera puede leer, crear, modificar y borrar arqueos de **todas** las empresas.
2. **Impacto real sobre stock (reproducido):** un anónimo cambia `fisico` de un arqueo pendiente ajeno; cuando el admin legítimo lo confirma, el stock queda en 5000 en vez de 48.
3. **Medio:** `bump_catalogo_empresa` y `bump_catalogo_sucursal` (SECURITY DEFINER) las puede ejecutar cualquier usuario autenticado con ids de otra empresa: invalida el caché de catálogo ajeno y contamina `catalogo_version`.
4. **Lo que está bien (verificado):** `ajustar_stock`, `confirmar_arqueo_stock` rechazan con `FORBIDDEN` a un admin de otra empresa y no tienen EXECUTE para `anon`; `crear_arqueo_stock` es solo `service_role`; `producto_stock` y `stock_movimientos` no se leen como anon.
5. **Corrección propuesta en dos partes**, probada 60/60 en el entorno aislado, con reversión que devuelve la huella exacta. La parte B depende de desplegar `feature/arqueo-servidor`.

## 2. Hallazgos

| # | Sev. | Hallazgo | Evidencia |
| --- | --- | --- | --- |
| H1 | Crítica | Policies abiertas en `arqueos_stock` y `arqueo_items` (`arq_all`, `arqi_all`, rol `public`) | A1–A8 |
| H2 | Crítica | `GRANT ALL` de tabla a `anon` y `authenticated` (default privileges de Supabase) sobre ambas tablas | A1–A5 |
| H3 | Alta | Adulteración de un arqueo pendiente ajeno → stock manipulado al confirmar | A11 |
| H4 | Media | Alta de un arqueo `pendiente` falso en una sucursal ajena: el índice único parcial `(empresa_id, sucursal_id) WHERE pendiente` impide que la sucursal cargue su arqueo real (denegación de servicio) | A4 |
| H5 | Media | `bump_catalogo_*` ejecutables por `authenticated` con cualquier empresa/sucursal. No toca stock ni precios, pero obliga a todos los kioscos de la víctima a recargar catálogo y permite insertar filas basura en `catalogo_version` | A9, A10 |
| H6 | Baja | `arqueo_items` no tiene `empresa_id` ni FK a producto: el aislamiento depende de la policy sobre el padre | diseño |
| H7 | Baja / informativo | `ajustar_stock` y `confirmar_arqueo_stock` validan empresa solo si `session_user = 'authenticator'`. En Supabase todo tráfico PostgREST entra como `authenticator`, así que **hoy es efectivo**; depende de que nadie conecte con otro rol (p. ej. un edge function con rol propio). No hay sucursal-scope (`ADMIN_SUCURSAL`), igual que en stock; los comentarios del código lo dejan como decisión aparte | C1–C4 |

Escenario concreto de H1+H3: la anon key sale del bundle web → `GET /rest/v1/arqueos_stock?select=*,arqueo_items(*)` devuelve todas las empresas, sucursales y productos → `PATCH /rest/v1/arqueo_items?arqueo_id=eq.<id>` con `fisico=5000` → el admin ve el arqueo pendiente, confirma como siempre, y `ajustar_stock` aplica el delta adulterado con motivo `arqueo` (el libro queda coherente pero con una diferencia falsa).

## 3. Cómo lo usa el código hoy (relevado en el repo)

- **Alta del arqueo, rama `main`:** `VistaCaja.tsx` inserta en `arqueos_stock`/`arqueo_items` con el cliente del navegador (`createClient()`). Eso funciona **solo porque la policy está abierta**.
- **Alta del arqueo, `feature/arqueo-servidor`:** `/api/operacion/arqueo` con `device_token` + sesión de operador y cliente de servicio; usa `service_role`, que ignora RLS.
- **Confirmación (ambas ramas):** pantalla Ventas del admin, cliente autenticado: `select` de arqueos con ítems, `update arqueo_items` (`descartado`, `ajustado`), `rpc('ajustar_stock')`, `update arqueos_stock` (`estado`, `confirmado_por`, `confirmado_at`). La RPC `confirmar_arqueo_stock` existe pero la pantalla todavía no la usa.

Por eso la corrección **deja a `authenticated` con SELECT y UPDATE de solo esas columnas** y nada más.

## 4. Propuesta (`arqueos-seguridad-correccion.sql`)

**Parte A · bump_catalogo (independiente, aplicable ya).** `trg_bump_catalogo` pasa a `SECURITY DEFINER` (mismo cuerpo) y se revoca EXECUTE de `bump_catalogo_*` a `authenticated`. Antes el trigger corría como el rol que escribe, por eso necesitaba el permiso; ahora no. Se probó que editar catálogo y editar `producto_stock` desde el cliente admin siguen disparando el bump (L8, L9) y que `service_role` conserva la función (L10).

**Parte B · arqueos (requiere `arqueo-servidor` desplegada).**
- Se eliminan `arq_all` y `arqi_all`.
- `authenticated`: SELECT y UPDATE solo sobre arqueos de su empresa (`auth_empresa_id()`) o `SUPER_ADMIN`; `arqueo_items` se resuelve por el padre.
- Permisos de tabla: `anon` sin nada; `authenticated` solo SELECT y UPDATE de columna (`estado, confirmado_por, confirmado_at` / `descartado, ajustado`). **No puede tocar `fisico`, `teorico` ni `empresa_id`**, ni insertar ni borrar.
- Alta y baja: solo servidor.

**Riesgo de aplicar B antes de tiempo:** el alta de arqueo desde la caja en `main` deja de funcionar (es justamente el agujero). Orden obligatorio: deploy de `arqueo-servidor` → verificar un arqueo real de punta a punta → recién ahí parte B.

**Orden:** 1) parte A cuando el CTO lo autorice; 2) deploy de `arqueo-servidor`; 3) parte B; 4) verificación (sección 6). Reversión: `arqueos-seguridad-REVERSION.sql` (cada parte por separado; reabre el agujero).

## 5. Evidencia (`tests/evidencia-seguridad.txt`: 60 de 60 pasan)

Entorno: Postgres 16 local, roles `anon`/`authenticated`/`service_role`/`authenticator` con la misma mecánica de PostgREST (conexión como `authenticator`, `SET ROLE`, claims JWT en `request.jwt.claims`), default privileges como Supabase, RLS activado. Las funciones (`ajustar_stock`, `confirmar_arqueo_stock`, `crear_arqueo_stock`, `trg_bump_catalogo`, `bump_catalogo_*`) se extrajeron **textualmente** de los volcados 03 y 05; las policies y el DDL de arqueos, del 01.

- **Antes:** los 11 ataques A1–A11 prosperan.
- **Después:** los 11 quedan bloqueados (`permission denied` o 0 filas), y el stock tras confirmar vale 48.
- **Controles C1–C7** pasan antes y después (defensas que ya existían).
- **Flujos legítimos L1–L10** pasan antes y después: el admin de la empresa lista, descarta, ajusta, marca, cierra y confirma por RPC; `SUPER_ADMIN` ve todo; `service_role` crea por RPC y escribe directo; el catálogo sigue haciendo bump.
- **Reversión:** la huella (policies, privilegios de tabla y de columna, EXECUTE por rol, `secdef`) vuelve a ser idéntica a la inicial; reaplicar da la misma huella que la primera vez.

Reproducir: `python3 tests/prueba_seguridad.py` (cluster en `/tmp/pgsock:54329`).

## 6. Qué NO pude verificar (sin acceso a la base real)

- El entorno es una réplica mínima, no Supabase: no hay PostgREST ni GoTrue reales. Los claims JWT se simulan.
- No sé si existen **otras policies o grants no volcados** sobre estas tablas, ni el RLS/policies reales de `catalogo_version` (asumí RLS activo sin policies de escritura).
- No sé qué rol usa el dispositivo de caja/kiosco en producción (asumo `anon`, sin sesión Supabase).
- Si hay **edge functions, cron jobs o integraciones** que lean `arqueos_stock` con otro rol.
- Si hay `default privileges` distintos a los estándar de Supabase.
- No se auditó el resto de las tablas (solo se anotó que `stock_movimientos`, `producto_stock` y `catalogo_version` tienen GRANT a anon y dependen de RLS).

**SELECT de solo lectura que pido que corra JC en el SQL Editor** (no modifican nada) para cerrar esos huecos:

```sql
-- 1) Todas las policies de las tablas implicadas
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='public'
  and tablename in ('arqueos_stock','arqueo_items','catalogo_version','producto_stock','stock_movimientos');

-- 2) Privilegios de tabla reales
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs
from information_schema.role_table_grants
where table_schema='public' and table_name in ('arqueos_stock','arqueo_items','catalogo_version')
group by 1,2 order by 1,2;

-- 3) Privilegios por columna (si ya hubiera alguno)
select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema='public' and table_name in ('arqueos_stock','arqueo_items') and grantee in ('anon','authenticated');

-- 4) Quién puede ejecutar qué (funciones relacionadas)
select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) owner, p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ajustar_stock','confirmar_arqueo_stock','crear_arqueo_stock','bump_catalogo_empresa','bump_catalogo_sucursal','trg_bump_catalogo');

-- 5) Default privileges del esquema
select pg_get_userbyid(defaclrole) rol, defaclobjtype, defaclacl from pg_default_acl;

-- 6) Triggers sobre las tablas de arqueo (se asumió que no hay)
select event_object_table, trigger_name, action_statement from information_schema.triggers
where event_object_table in ('arqueos_stock','arqueo_items');

-- 7) ¿Hay arqueos o ítems sospechosos? (cargados por anon, o con empresa que no coincide con la sucursal)
select a.id, a.empresa_id, a.sucursal_id, a.estado, a.contado_por, a.created_at
from arqueos_stock a left join sucursales s on s.id=a.sucursal_id and s.empresa_id=a.empresa_id
where s.id is null;
```

La consulta 7 sirve para saber si el agujero **ya fue explotado**: cualquier fila sin sucursal coincidente es un arqueo falso. Conviene mirar también `stock_movimientos` con `motivo='arqueo'` y detalles que no reconozcan.

## 7. Entregables

| Archivo | Para qué |
| --- | --- |
| `arqueos-seguridad-correccion.sql` | Partes A y B, cada una en su transacción |
| `arqueos-seguridad-REVERSION.sql` | Reversión exacta por parte |
| `tests/prueba_seguridad.py` | Prueba reproducible (ataques, controles, flujos legítimos, reversión) |
| `tests/00-esquema-minimo.sql`, `01-triggers.sql`, `funciones-vivas-extraidas.sql` | Esquema y funciones usadas |
| `tests/evidencia-seguridad.txt`, `huella-antes.txt`, `huella-despues.txt` | Salida y huellas |
