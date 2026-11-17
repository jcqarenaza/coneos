-- EXTRAS para probar la CONVERSIÓN rama → producto (volver_modelo_producto + _restaurar_producto_stock, REALES de cones-prod 17/11) en el Postgres local descartable.
-- Se carga DESPUÉS de 00-schema-reducido.sql y 00-extras.sql. NO es Supabase. Tablas y ayudantes = stubs mínimos con las columnas que usan las dos funciones.
drop table if exists stock_rama_habilitacion; drop table if exists stock_rama;
drop function if exists public._registrar_operacion(uuid, uuid, text, text, text);
create table stock_rama_habilitacion (id uuid primary key default gen_random_uuid(), empresa_id uuid, producto_id uuid not null, sucursal_id uuid not null,
  ciclo int not null default 1, estado text not null, decision text, saldo_anterior numeric not null default 0, total_contado numeric not null default 0,
  operacion_id uuid, usuario_id uuid, activada_at timestamptz default now(), revertida_at timestamptz);
create table stock_rama (id uuid primary key default gen_random_uuid(), empresa_id uuid not null, sucursal_id uuid not null, producto_id uuid not null,
  presentacion_id uuid, cantidad numeric not null default 0 check (cantidad >= 0), updated_at timestamptz default now());
create table stock_operaciones (operacion_id uuid primary key, empresa_id uuid not null, tipo text not null, resultado jsonb, created_at timestamptz not null default now());
create table stock_rama_reversion (id uuid primary key default gen_random_uuid(), empresa_id uuid, habilitacion_id uuid, producto_id uuid, sucursal_id uuid,
  saldo_anterior_congelado numeric, total_contado numeric, saldo_restaurado numeric, diferencia numeric, operacion_id uuid, usuario_id uuid, movimiento_id uuid);
create function public._validar_usuario_stock_empresa(uuid, uuid) returns void language sql as $$ select $$;
create function public._exigir_read_committed() returns void language sql as $$ select $$;
create function public._a0_exclusivo() returns void language sql as $$ select $$;
create function public._registrar_operacion(p_op uuid, p_emp uuid, p_tipo text, p_huella text, p_usr uuid) returns jsonb language plpgsql as $$
begin insert into stock_operaciones(operacion_id, empresa_id, tipo) values (p_op, p_emp, p_tipo) on conflict do nothing; return '{"estado":"nueva"}'::jsonb; end $$;
create or replace function public._completar_operacion(p_op uuid, p_res jsonb) returns void language sql as $$ update stock_operaciones set resultado = p_res where operacion_id = p_op $$;
alter table stock_movimientos add column if not exists usuario_id uuid;
-- el esquema reducido no admite el motivo 'apertura' (lo escribe habilitar_modelo_rama en la viva) ni tiene estado en conteos
alter table stock_movimientos drop constraint stock_mov_doc_chk;
alter table stock_movimientos add constraint stock_mov_doc_chk check ((((motivo = 'venta'::text) AND (pedido_id IS NOT NULL) AND (remito_id IS NULL) AND (comprobante_compra_id IS NULL)) OR ((motivo = 'compra'::text) AND (articulo_id IS NOT NULL) AND (pedido_id IS NULL) AND ((((remito_id IS NOT NULL))::integer + ((comprobante_compra_id IS NOT NULL))::integer) = 1)) OR ((motivo = 'devolucion_compra'::text) AND (articulo_id IS NOT NULL) AND (pedido_id IS NULL) AND (remito_id IS NOT NULL) AND (comprobante_compra_id IS NULL)) OR ((motivo = ANY (ARRAY['arqueo'::text, 'ajuste'::text, 'devolucion'::text, 'apertura'::text])) AND (remito_id IS NULL) AND (comprobante_compra_id IS NULL))));
alter table stock_conteos add column if not exists estado text not null default 'pendiente';
