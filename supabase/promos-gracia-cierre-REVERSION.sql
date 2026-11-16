-- Reversión de promos-gracia-cierre.sql (correr MANUAL). Volver antes al código anterior si ya no la usa.
begin;
alter table public.promociones drop constraint if exists promociones_gracia_check;
alter table public.promociones drop column if exists gracia_cierre_min;
commit;
