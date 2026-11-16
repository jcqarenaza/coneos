-- ═══════════════════════════════════════════════════════════════════
-- Promociones: margen al cierre (minutos) configurable por promo
-- Correr MANUAL en Supabase SQL Editor (cones-prod). Aditivo: default 5, las promos existentes no cambian.
-- Es el margen en que todavía se acepta un pedido con la promo DESPUÉS de su hora de cierre.
-- ═══════════════════════════════════════════════════════════════════
begin;
alter table public.promociones
  add column if not exists gracia_cierre_min smallint not null default 5;
alter table public.promociones drop constraint if exists promociones_gracia_check;
alter table public.promociones add constraint promociones_gracia_check check (gracia_cierre_min between 0 and 60);
commit;

select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'promociones' and column_name = 'gracia_cierre_min';
