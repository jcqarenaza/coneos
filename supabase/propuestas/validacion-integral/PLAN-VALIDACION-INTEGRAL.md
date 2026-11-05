# Validación integral Stock V2: plan del entorno aislado

4/11/2026 · Orden CTO punto 5 · **Estado: preparado, falta el esquema real para ejecutarla**

## 1. Qué entorno y por qué

Un Supabase "de laboratorio" **fuera** del proyecto compartido, armado en el contenedor de pruebas:

| Pieza | Real o simulada |
| --- | --- |
| PostgreSQL 16 | Real (cluster local por socket, sin red) |
| PostgREST 12.2.12 | **Real** (binario oficial ya descargado y verificado) |
| Roles `anon`, `authenticated`, `authenticator`, `service_role` + GRANTs/default privileges | Reales, tal cual el volcado |
| RLS y policies | **Reales** (las del volcado) |
| Tablas, FKs, índices, triggers, funciones | **Reales** (las del volcado), no el esquema reducido |
| JWT | Firmados con un secreto de prueba; claims `role`, `sub`, `empresa_id` como los usa `auth_rol()` / `auth_empresa_id()` |
| Next.js (rutas `/api/*`, admin, kiosco) | El código real del repo, apuntando a PostgREST local (un proxy mapea `/rest/v1`) |
| Navegador | Playwright (Chromium ya instalado) contra el Next local |
| Realtime (websocket) | **No**: Supabase Realtime no es reproducible acá. Se prueba el efecto (`catalogo_version`), no el canal |
| GoTrue (login) | **No**: se emiten JWT firmados con las mismas claims |

Nada de esto toca el proyecto compartido `wpiwjpvjqshsgrxxwsld`. No hay credenciales de producción en el contenedor.

## 2. Lo que necesito de JC (solo lectura, no ejecuta SQL nuevo ni modifica nada)

Un volcado de **solo esquema** de `public`, sin datos. Elegir UNA opción (la contraseña la escribe él, no me la pasa):

```
pg_dump --schema-only --schema=public --no-owner -f schema-public.sql "postgresql://postgres:TU_PASSWORD@db.wpiwjpvjqshsgrxxwsld.supabase.co:5432/postgres"
```

o, con la CLI de Supabase (requiere Docker):

```
npx supabase db dump --db-url "postgresql://postgres:TU_PASSWORD@db.wpiwjpvjqshsgrxxwsld.supabase.co:5432/postgres" --schema public -f schema-public.sql
```

Debe incluir los `GRANT`/`ALTER DEFAULT PRIVILEGES` (no usar `--no-privileges`). Después adjuntar `schema-public.sql` al chat. Si no se puede correr `pg_dump`, la alternativa es que yo arme consultas de catálogo de **solo lectura** (SELECT sobre `pg_catalog`) para pegar en el SQL Editor y exportar el resultado; es más lento.

## 3. Matriz de la orden del CTO: dónde estamos

| Prueba pedida | Hecha en el entorno reducido | Falta en el integral |
| --- | --- | --- |
| Venta x8 y porción x1 | Sí (24/24) | Repetir por HTTP (PostgREST + `/api/pedidos`) con RLS |
| Cambio de factor entre venta y devolución | Sí | Con el admin real cambiando el factor por la pantalla |
| Devolución repetida | Sí (15/15 con la RPC nueva) | Doble click real contra `/api/pedidos/eliminar` |
| Pedidos históricos con snapshot NULL | Sí | Con datos sembrados como producción |
| Promociones con componentes | Sí | Por HTTP con el catálogo real |
| Pedidos de mesa | Sí | Flujo de mesa completo |
| Stock insuficiente | Sí | 409 con el cuerpo nuevo y el kiosco real |
| Concurrencia venta contra venta | Sí | Con PostgREST (pool real de conexiones) |
| Concurrencia venta contra compra | Sí (con el hallazgo del trigger) | Con `ingresar_remito_stock` y `_registrar_comprobante_compra` reales |
| Fallos intermedios y rollback | Sí | Cortar la conexión a mitad de la ruta HTTP |
| Ruta HTTP real de eliminar | **No** | Sí |
| Admin y kiosco | **No** (solo typecheck) | Sí, con Playwright |
| Migración y reversión | Sí en reducido | Sobre el esquema real con datos sembrados |
| **Combinados** (bump diferido + `SECURITY DEFINER` de arqueos + devolución transaccional) | **No** | Sí: son tres cambios que tocan el mismo trigger/tablas |

## 4. Orden de ejecución una vez que llegue el volcado

1. Levantar Postgres + cargar `schema-public.sql` + crear roles Supabase + sembrar una empresa con 2 sucursales, catálogo (x8, x20, porción, promos, opciones), stock y pedidos históricos con snapshot NULL.
2. Levantar PostgREST con el JWT de prueba y comprobar `GET /rest/v1/productos` como `anon` y como `authenticated`.
3. Aplicar en el entorno, en este orden: migración V2 → RPC v1.6 → bump diferido → orden de Compras → arqueos A (y B con `arqueo-servidor`) → `devolver_stock_pedido`.
4. Correr la matriz de HTTP + concurrencia + rollback y la de seguridad de arqueos por PostgREST real.
5. Playwright: admin (campo "Consume del stock"), kiosco (venta x8, 409), mesa.
6. Reversión de cada paso en orden inverso y comprobar la huella del esquema.
7. Informe con la evidencia.

## 5. Qué no podrá probar ni este entorno

Realtime real, GoTrue real, extensiones propias de Supabase, carga de producción y latencia de red. Lo que quede ahí se declara como límite en el informe.
