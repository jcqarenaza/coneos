-- Reversión de promos-horario-vigencia.sql. Correr MANUAL en Supabase SQL Editor.
-- Primero hay que volver al código anterior (sin hora_desde/hora_hasta); si no, el catálogo fallaría.
begin;
alter table public.promociones drop constraint if exists promociones_horas_check;
alter table public.promociones drop column if exists hora_desde, drop column if exists hora_hasta;
commit;
