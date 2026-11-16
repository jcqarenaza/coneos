-- ═══════════════════════════════════════════════════════════════════
-- Promociones: hora de inicio y hora de cierre (opcionales)
-- Correr MANUAL en Supabase SQL Editor (cones-prod) ANTES de deployar el código.
-- Aditivo y seguro: dos columnas nuevas, nulas por defecto. Las promos existentes
-- no cambian (sin hora = rigen por día completo, igual que hoy).
-- Ejemplo: vigencia_desde=2026-11-18 + hora_desde=18:00, vigencia_hasta=2026-11-19 + hora_hasta=02:00
-- ═══════════════════════════════════════════════════════════════════
begin;

alter table public.promociones
  add column if not exists hora_desde time,
  add column if not exists hora_hasta time;

-- Si empieza y termina el mismo día, la hora de cierre debe ser posterior a la de inicio.
-- (La regla existente promociones_check1 ya exige vigencia_hasta >= vigencia_desde.)
alter table public.promociones drop constraint if exists promociones_horas_check;
alter table public.promociones add constraint promociones_horas_check check (
  vigencia_desde is null or vigencia_hasta is null or hora_desde is null or hora_hasta is null
  or vigencia_hasta > vigencia_desde or hora_hasta > hora_desde
);

commit;

-- Verificación (debe devolver 2 filas: hora_desde y hora_hasta, tipo time):
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'promociones' and column_name in ('hora_desde', 'hora_hasta')
order by column_name;
