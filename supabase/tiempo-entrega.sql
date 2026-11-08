-- ============================================================
-- TIEMPO PROMEDIO DE ENTREGA (cierre CTO 08/11)
-- Correr MANUAL en Supabase SQL Editor. Idempotente. Solo agrega.
--
-- * pedidos.salio_at     = momento en que la moto se aleja del punto de partida (automático por GPS).
-- * pedidos.entregado_at = momento en que marca ENTREGADO (ya la escribe
--   /api/reparto; el IF NOT EXISTS la crea si la base no la tuviera).
-- * CHECK: entregado_at >= salio_at (NOT VALID: no revisa filas viejas).
-- * tiempo_promedio_entrega(): promedio general y por cadete. Solo
--   cuenta pedidos DELIVERED con salida y entrega registradas, con
--   entrega >= salida y duración <= p_tope_min (default 240 min:
--   un cadete que olvidó cerrar no ensucia el promedio; se informa
--   cuántos se descartaron).
-- REVERSIÓN al final (comentada).
-- ============================================================
begin;
set local lock_timeout = '5s';

alter table public.pedidos add column if not exists salio_at timestamptz;
alter table public.pedidos add column if not exists entregado_at timestamptz;

-- Punto de partida (se fija con el primer ping con pedidos listos; salio_at se marca
-- cuando la moto se aleja). Vive en la fila de posición, que ya se borra al terminar el reparto.
alter table public.reparto_posiciones add column if not exists base_lat double precision;
alter table public.reparto_posiciones add column if not exists base_lng double precision;

do $c$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'pedidos_tiempos_entrega_ck'
                   and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_tiempos_entrega_ck
      check (salio_at is null or entregado_at is null or entregado_at >= salio_at) not valid;
  end if;
end $c$;

create or replace function public.tiempo_promedio_entrega(
  p_empresa_id uuid,
  p_sucursal_id uuid default null,
  p_desde timestamptz default (now() - interval '30 days'),
  p_hasta timestamptz default now(),
  p_tope_min integer default 240
) returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $f$
declare
  v jsonb;
begin
  with base as (
    select p.colaborador_id, p.colaborador_nombre,
           extract(epoch from (p.entregado_at - p.salio_at)) / 60.0 as min
      from public.pedidos p
     where p.empresa_id = p_empresa_id
       and (p_sucursal_id is null or p.sucursal_id = p_sucursal_id)
       and p.estado = 'DELIVERED'
       and p.salio_at is not null and p.entregado_at is not null
       and p.entregado_at >= p.salio_at
       and p.entregado_at >= p_desde and p.entregado_at < p_hasta
  ), ok as (select * from base where min <= p_tope_min)
  select jsonb_build_object(
    'general', jsonb_build_object(
      'entregas', (select count(*) from ok),
      'promedio_min', (select round(avg(min)::numeric, 1) from ok),
      'descartados_por_tope', (select count(*) from base where min > p_tope_min)),
    'cadetes', coalesce((select jsonb_agg(jsonb_build_object(
        'colaborador_id', colaborador_id, 'nombre', nombre,
        'entregas', n, 'promedio_min', prom) order by nombre)
      from (select colaborador_id, max(colaborador_nombre) as nombre,
                   count(*) as n, round(avg(min)::numeric, 1) as prom
              from ok group by colaborador_id) t), '[]'::jsonb))
  into v;
  return v;
end $f$;

revoke all on function public.tiempo_promedio_entrega(uuid, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.tiempo_promedio_entrega(uuid, uuid, timestamptz, timestamptz, integer) to service_role;

commit;

-- REVERSIÓN (solo si hace falta; borra los tiempos de salida registrados):
-- drop function if exists public.tiempo_promedio_entrega(uuid, uuid, timestamptz, timestamptz, integer);
-- alter table public.pedidos drop constraint if exists pedidos_tiempos_entrega_ck;
-- alter table public.reparto_posiciones drop column if exists base_lat, drop column if exists base_lng;
-- alter table public.pedidos drop column if exists salio_at;   -- NO borrar entregado_at: ya existía
