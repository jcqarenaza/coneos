# Matriz de aceptación — Stock V2 factor

Corre contra un Postgres local aislado (socket unix, sin red). Nunca contra Supabase.

## Cómo repetirla (Linux, Postgres 16 instalado)

```
mkdir -p /tmp/pgsock && chown postgres /tmp/pgsock
su postgres -c "initdb -D /tmp/pgtest -A trust -U postgres"
su postgres -c "pg_ctl -D /tmp/pgtest -o \"-p 54329 -k /tmp/pgsock -c listen_addresses='' -c deadlock_timeout=500ms\" -l /tmp/pgtest.log -w start"
pip install psycopg2-binary
python3 matriz.py v2     # migración + RPC v1.6: deben pasar las 24 pruebas
python3 matriz.py base   # control: la RPC viva actual; deben FALLAR las pruebas que exigen el factor
```

## Qué es y qué no es

- `00-schema-reducido.sql`: solo las tablas y columnas que tocan la venta y la devolución. Constraints, índices, triggers (`bump_catalogo`) y funciones (`ajustar_stock`) copiados de la base viva el 4/11/2026. No incluye RLS, ni los FKs hacia Compras, ni columnas ajenas. Las funciones `auth.role()`, `auth_rol()` y `auth_empresa_id()` son stubs de prueba.
- La devolución de `/api/pedidos/eliminar` se prueba de dos maneras: la misma secuencia de SQL (flip atómico, lectura de snapshot, `ajustar_stock`) en `matriz.py`, y la función pura `src/lib/stock/devolucion.ts` en Node (7 casos). No se probó la ruta HTTP de punta a punta contra Supabase.
- `evidencia-v2.txt` y `evidencia-control-rpc-viva.txt` son las salidas de la corrida del 4/11/2026.
