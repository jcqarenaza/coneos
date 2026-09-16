-- ============================================================
-- STOCK V1 REAL — P0: trazabilidad + atomicidad
-- Orden CTO 17/09/2026. "De 'parece funcionar' a 'podemos
-- demostrar qué pasó con cada unidad'."
-- ============================================================

-- 1) EL LIBRO: todo movimiento de stock queda escrito
create table if not exists stock_movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  sucursal_id uuid not null,
  producto_id uuid not null,
  delta integer not null,              -- negativo = salida, positivo = entrada
  motivo text not null,                -- venta | devolucion | ajuste | carga_inicial
  pedido_id uuid null,                 -- referencia cuando aplica
  detalle text null,
  created_at timestamptz not null default now()
);
create index if not exists idx_stockmov_prod on stock_movimientos (producto_id, sucursal_id, created_at desc);
create index if not exists idx_stockmov_pedido on stock_movimientos (pedido_id) where pedido_id is not null;

-- 2) LA ÚNICA PUERTA fuera de la venta: ajuste atómico + log en el mismo acto.
--    Imposible mover stock por acá sin dejar rastro.
--    p_modo: 'delta' (suma p_valor, puede ser negativo) | 'set' (fija cantidad).
create or replace function public.ajustar_stock(
  p_empresa_id uuid, p_sucursal_id uuid, p_producto_id uuid,
  p_valor integer, p_modo text default 'delta',
  p_motivo text default 'ajuste', p_pedido_id uuid default null, p_detalle text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_old integer;
  v_new integer;
  v_id uuid;
begin
  -- lock de la fila: el cálculo old→new es atómico frente a ventas/devoluciones
  select id, cantidad into v_id, v_old
    from producto_stock
    where producto_id = p_producto_id and sucursal_id = p_sucursal_id
    for update;

  if v_id is null then
    -- primera vez (carga inicial): nace la fila
    v_old := 0;
    v_new := case when p_modo = 'set' then p_valor else v_old + p_valor end;
    insert into producto_stock (empresa_id, producto_id, sucursal_id, cantidad, stock_minimo, updated_at)
      values (p_empresa_id, p_producto_id, p_sucursal_id, v_new, 0, now())
      returning id into v_id;
  else
    v_new := case when p_modo = 'set' then p_valor else v_old + p_valor end;
    update producto_stock set cantidad = v_new, updated_at = now() where id = v_id;
  end if;

  if v_new <> v_old then
    insert into stock_movimientos (empresa_id, sucursal_id, producto_id, delta, motivo, pedido_id, detalle)
      values (p_empresa_id, p_sucursal_id, p_producto_id, v_new - v_old, p_motivo, p_pedido_id, p_detalle);
  end if;

  return jsonb_build_object('cantidad', v_new, 'anterior', v_old, 'delta', v_new - v_old);
end;
$$;

select 'stock v1 real: tabla + funcion ok' as listo;
