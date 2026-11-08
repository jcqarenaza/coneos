-- ══════════════════════════════════════════════════════════════════════
-- Reversión de pedidos-repetidos.sql — DESTRUCTIVA, y PROTEGE lo que ya existía antes de la entrega.
-- Antes: (1) volver el código (api/pedidos y clientes) a la versión anterior y (2) correr la reversión de
-- crear-pedido-stock-v1.7-operacion.sql (esa va PRIMERO).
-- SE PIERDE: todo el registro de operaciones (pedido_operaciones: historial de idempotencia y de advertencias) y la
-- configuración por empresa de prevención (activar/desactivar y minutos). No toca pedidos ni stock.
-- PROTECCIÓN (revisión CTO 8/11): pedidos-repetidos.sql MARCA con un COMMENT ('coneos:pedidos-repetidos-8-11') cada objeto que
-- ÉL creó. Esta reversión borra SOLO lo marcado. Una tabla, columna o constraint que ya existía antes (sin marca) se CONSERVA
-- con sus datos y se informa con un NOTICE. pedidos.operacion_id NO se toca acá (la borra la reversión de v1.7, si está marcada).
-- Para ejecutarla hay que aceptar expresamente la pérdida: descomentar la línea siguiente.
-- set coneos.acepto_perdida_historial = 'si';
-- ══════════════════════════════════════════════════════════════════════
do $$ begin
  if coalesce(current_setting('coneos.acepto_perdida_historial', true), '') <> 'si' then
    raise exception 'REVERSION_NO_CONFIRMADA: es destructiva (pierde pedido_operaciones y la configuración de repetidos). Descomentá el SET del encabezado para aceptarlo.';
  end if;
end $$;
begin;
set local lock_timeout = '5s';
do $rev$
declare r record; m constant text := 'coneos:pedidos-repetidos-8-11';
begin
  -- funciones: solo las marcadas
  for r in select p.oid::regprocedure as f, obj_description(p.oid, 'pg_proc') as c from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('reclamar_operacion_pedido', 'completar_operacion_pedido', 'liberar_operacion_pedido', 'purgar_operaciones_pedido') loop
    if r.c = m then execute 'drop function ' || r.f::text; else raise notice 'SE CONSERVA la función % (no la creó este script)', r.f; end if;
  end loop;
  -- tabla de operaciones
  if to_regclass('public.pedido_operaciones') is not null then
    if obj_description('public.pedido_operaciones'::regclass, 'pg_class') = m then drop table public.pedido_operaciones;
    else raise notice 'SE CONSERVA la tabla pedido_operaciones (ya existía antes: sin marca) y sus datos'; end if;
  end if;
  -- índice sobre una tabla preexistente que sí creamos nosotros
  if to_regclass('public.idx_pedido_operaciones_huella') is not null then
    if obj_description('public.idx_pedido_operaciones_huella'::regclass, 'pg_class') = m then drop index public.idx_pedido_operaciones_huella; end if;
  end if;
  -- constraint de rango: solo si es la de empresa_config y está marcada
  if exists (select 1 from pg_constraint c where c.conname = 'empresa_config_pedidos_repetidos_minutos_rango' and c.conrelid = 'public.empresa_config'::regclass) then
    if (select obj_description(c.oid, 'pg_constraint') from pg_constraint c where c.conname = 'empresa_config_pedidos_repetidos_minutos_rango' and c.conrelid = 'public.empresa_config'::regclass) = m then
      alter table public.empresa_config drop constraint empresa_config_pedidos_repetidos_minutos_rango;
    else raise notice 'SE CONSERVA la constraint empresa_config_pedidos_repetidos_minutos_rango (ya existía antes)'; end if;
  end if;
  -- columnas de configuración: solo las marcadas
  for r in select a.attname::text as col, col_description(a.attrelid, a.attnum) as c from pg_attribute a
            where a.attrelid = 'public.empresa_config'::regclass and a.attnum > 0 and not a.attisdropped
              and a.attname in ('pedidos_repetidos_minutos', 'prevenir_pedidos_repetidos') loop
    if r.c = m then execute format('alter table public.empresa_config drop column %I', r.col);
    else raise notice 'SE CONSERVA la columna empresa_config.% (ya existía antes)', r.col; end if;
  end loop;
end $rev$;
commit;
