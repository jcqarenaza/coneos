-- ============================================================
-- BALDES: pasar las ventas viejas a la presentación nueva de cada variedad
-- y borrar las presentaciones viejas "Balde 2L / 3L / 5L".
-- Correr MANUAL en Supabase SQL Editor, DESPUÉS de baldes-por-variedad(-federal).sql.
-- Empresas: Federal y Cecchetto (cambiar la lista v_empresas si hace falta).
--
-- Qué hace:
--   1. Guarda un respaldo en la tabla _bak_baldes_items (item y presentación vieja).
--   2. Cada venta (pedido_items) de Balde 2L/3L/5L pasa a la presentación nueva que
--      se llama igual que la variedad elegida (la que quedó en la venta). Solo ventas
--      con UNA variedad y con coincidencia exacta de nombre; el resto no se toca.
--      Precio, cantidad y nombres guardados en la venta NO cambian: los reportes dan igual.
--   3. Borra cada presentación vieja SOLO si ya nadie la usa (ventas, arqueos,
--      artículos de compras, promociones, stock por presentación). Si algo la usa, la deja.
--   Se puede correr más de una vez.
-- Deshacer las ventas: ver ROLLBACK al final (usa el respaldo). Las presentaciones
-- borradas no vuelven: por eso el respaldo guarda el id viejo solo de las ventas.
-- ============================================================
begin;

create table if not exists public._bak_baldes_items (
  item_id uuid primary key,
  presentacion_id_vieja uuid not null,
  presentacion_id_nueva uuid not null,
  fecha timestamptz not null default now()
);

do $$
declare
  v_empresas uuid[] := array['ce000000-0000-0000-0000-000000000001'::uuid, 'cdd77401-6b81-474f-b96c-8faaca1476fd'::uuid];
  v_movidas int := 0;
  v_borradas int := 0;
begin
  create temp table _mv on commit drop as
  select i.id as item_id, i.presentacion_id as vieja,
         (select nv.id from presentaciones nv
           where nv.producto_id = pv.producto_id and nv.id <> pv.id
             and lower(trim(nv.nombre)) = lower(trim(min(io.nombre_snap)))
           limit 1) as nueva
  from pedido_items i
  join presentaciones pv on pv.id = i.presentacion_id
  join productos p on p.id = pv.producto_id
  join pedido_item_opciones io on io.pedido_item_id = i.id
  where p.empresa_id = any (v_empresas)
    and pv.nombre in ('Balde 2L', 'Balde 3L', 'Balde 5L')
    and p.nombre in ('Balde 2 litros', 'Balde 3 litros', 'Balde 5 litros')
  group by i.id, i.presentacion_id, pv.producto_id, pv.id
  having count(io.id) = 1;

  insert into _bak_baldes_items (item_id, presentacion_id_vieja, presentacion_id_nueva)
  select item_id, vieja, nueva from _mv where nueva is not null
  on conflict (item_id) do nothing;

  update pedido_items i set presentacion_id = m.nueva
    from _mv m where m.item_id = i.id and m.nueva is not null;
  get diagnostics v_movidas = row_count;

  -- Borrar las presentaciones viejas que ya no usa nadie
  delete from presentaciones pr
   where pr.nombre in ('Balde 2L', 'Balde 3L', 'Balde 5L')
     and pr.producto_id in (select id from productos where empresa_id = any (v_empresas) and nombre in ('Balde 2 litros', 'Balde 3 litros', 'Balde 5 litros'))
     and not exists (select 1 from pedido_items x where x.presentacion_id = pr.id)
     and not exists (select 1 from arqueo_items x where x.presentacion_id = pr.id)
     and not exists (select 1 from articulos x where x.presentacion_id = pr.id)
     and not exists (select 1 from promo_slot_presentaciones x where x.presentacion_id = pr.id)
     and not exists (select 1 from stock_rama x where x.presentacion_id = pr.id);
  get diagnostics v_borradas = row_count;

  raise notice 'Ventas pasadas a la variedad: % · presentaciones viejas borradas: %', v_movidas, v_borradas;
end $$;

-- Control: ventas que quedaron en una presentación vieja y presentaciones viejas que siguen
select
  (select count(*) from pedido_items i join presentaciones pr on pr.id = i.presentacion_id
    join productos p on p.id = pr.producto_id
   where pr.nombre in ('Balde 2L', 'Balde 3L', 'Balde 5L') and p.nombre like 'Balde % litros') as ventas_sin_pasar,
  (select count(*) from presentaciones pr join productos p on p.id = pr.producto_id
   where pr.nombre in ('Balde 2L', 'Balde 3L', 'Balde 5L') and p.nombre like 'Balde % litros') as presentaciones_viejas_que_quedan,
  (select count(*) from _bak_baldes_items) as ventas_respaldadas;

commit;

-- ROLLBACK de las ventas (correr aparte; vuelve cada venta a su presentación vieja SI esa presentación todavía existe):
-- update pedido_items i set presentacion_id = b.presentacion_id_vieja
--   from _bak_baldes_items b where b.item_id = i.id and exists (select 1 from presentaciones x where x.id = b.presentacion_id_vieja);
