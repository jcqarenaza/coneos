-- TAKE AWAY V1 — migración (correr en SQL Editor, proyecto wpiwjpvjqshsgrxxwsld)
-- Parte 1: estructura (inofensiva; defaults preservan comportamiento actual)
create table if not exists takeaway_config (
  sucursal_id uuid primary key references sucursales(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  activo boolean not null default false,
  horarios jsonb not null default '[]'::jsonb,
  mensaje_fuera_horario text,
  tolerancia_cierre int not null default 5,
  created_at timestamptz not null default now()
);

alter table sucursal_pagos add column if not exists acepta_mp_mesa boolean not null default true;
alter table sucursal_pagos add column if not exists acepta_mp_takeaway boolean not null default true;

-- Parte 2: RLS — el patrón debe CALCAR el de delivery_config.
-- Correr primero esta consulta y verificar que las políticas creadas abajo
-- coincidan en forma con las existentes (si difieren, avisar a Claude):
--   select policyname, cmd, qual, with_check from pg_policies where tablename = 'delivery_config';
alter table takeaway_config enable row level security;
do $$
declare pol record;
begin
  -- Clona automáticamente las políticas de delivery_config hacia takeaway_config
  for pol in
    select policyname, cmd, roles, qual, with_check
    from pg_policies where schemaname = 'public' and tablename = 'delivery_config'
  loop
    execute format(
      'create policy %I on takeaway_config as permissive for %s to %s %s %s',
      pol.policyname || '_ta',
      case pol.cmd when 'ALL' then 'all' else lower(pol.cmd) end,
      array_to_string(pol.roles, ', '),
      case when pol.qual is not null then 'using (' || pol.qual || ')' else '' end,
      case when pol.with_check is not null then 'with check (' || pol.with_check || ')' else '' end
    );
  end loop;
end $$;
-- Verificación final:
--   select policyname, cmd from pg_policies where tablename = 'takeaway_config';
