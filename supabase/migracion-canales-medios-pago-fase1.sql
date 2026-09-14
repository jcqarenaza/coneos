-- ============================================================
-- CANALES + MEDIOS DE PAGO V1 — FASE 1 (orden CTO 14/09)
-- SOLO modelo + migración de datos + seguridad.
-- Ningún consumidor: comportamiento de producción idéntico
-- (0 mapeos = legacy puro). Idempotente. Correr en SQL Editor.
-- ============================================================

-- ── PASO 0: FOTO ANTES (guardar el resultado para el informe) ──
select 'ANTES mp_credenciales' as foto, count(*) as filas,
       count(*) filter (where sucursal_id is null) as de_marca,
       count(*) filter (where access_token is not null) as con_token
from mp_credenciales;
select 'ANTES constraints/índices únicos de mp_credenciales' as foto,
       conname, pg_get_constraintdef(oid) as def
from pg_constraint where conrelid = 'mp_credenciales'::regclass and contype in ('u','p');
select 'ANTES sucursales con datos de transferencia' as foto, count(*) as filas
from sucursal_pagos
where coalesce(cbu_transferencia,'') <> '' or coalesce(mp_alias,'') <> '' or coalesce(titular_transferencia,'') <> '';

-- ── PASO 1: extender mp_credenciales ──
alter table mp_credenciales
  add column if not exists nombre text not null default 'Cuenta principal',
  add column if not exists activo boolean not null default true;

-- ── PASO 2: unicidad multi-cuenta ──
-- 2a. Descubrir y soltar el UNIQUE viejo sobre (empresa_id, sucursal_id)
--     por su NOMBRE REAL (punto 13: no asumir nombres).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'mp_credenciales'::regclass and contype = 'u'
      and (
        select array_agg(a.attname order by a.attname)
        from unnest(conkey) k join pg_attribute a
          on a.attrelid = conrelid and a.attnum = k
      ) = array['empresa_id','sucursal_id']::name[]
  loop
    execute format('alter table mp_credenciales drop constraint %I', c.conname);
    raise notice 'Constraint eliminado: %', c.conname;
  end loop;
end $$;
-- (si el viejo era un índice único sin constraint, también:)
do $$
declare i record;
begin
  for i in
    select indexrelid::regclass::text as idx from pg_index
    where indrelid = 'mp_credenciales'::regclass and indisunique and not exists
      (select 1 from pg_constraint where conindid = indexrelid)
      and (select array_agg(a.attname order by a.attname)
           from unnest(indkey) k join pg_attribute a
             on a.attrelid = indrelid and a.attnum = k) = array['empresa_id','sucursal_id']::name[]
  loop
    execute format('drop index %s', i.idx);
    raise notice 'Índice único eliminado: %', i.idx;
  end loop;
end $$;

-- 2b. Identidad nueva: (empresa, sucursal, mp_user_id) con NULL de sucursal
--     normalizado (dos cuentas de marca con el mismo mp_user jamás se duplican;
--     la MISMA cuenta real se actualiza al reconectar, una distinta crea fila).
create unique index if not exists mp_credenciales_identidad
  on mp_credenciales (empresa_id, coalesce(sucursal_id, '00000000-0000-0000-0000-000000000000'::uuid), mp_user_id);

-- 2c. Soporte para FK compuesta de tenant (paso 5): id+empresa únicos.
create unique index if not exists mp_credenciales_id_empresa
  on mp_credenciales (id, empresa_id);

-- ── PASO 3: cuentas_transferencia ──
create table if not exists cuentas_transferencia (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  sucursal_id uuid not null references sucursales(id),
  nombre text not null,
  alias text,
  cbu text,
  titular text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cuentas_transferencia_id_empresa
  on cuentas_transferencia (id, empresa_id);
create index if not exists idx_cuentas_transferencia_sucursal
  on cuentas_transferencia (sucursal_id);

-- ── PASO 4: migración legacy → "Cuenta 1" ──
-- mp_alias es HISTÓRICAMENTE el alias de transferencia → cuentas_transferencia.alias.
-- Solo sucursales con algún dato real; sin cuentas ficticias. Idempotente:
-- no duplica si ya existe una "Cuenta 1" para la sucursal.
insert into cuentas_transferencia (empresa_id, sucursal_id, nombre, alias, cbu, titular, activo)
select sp.empresa_id, sp.sucursal_id, 'Cuenta 1',
       nullif(sp.mp_alias, ''), nullif(sp.cbu_transferencia, ''), nullif(sp.titular_transferencia, ''), true
from sucursal_pagos sp
where (coalesce(sp.cbu_transferencia,'') <> '' or coalesce(sp.mp_alias,'') <> '' or coalesce(sp.titular_transferencia,'') <> '')
  and not exists (
    select 1 from cuentas_transferencia ct
    where ct.sucursal_id = sp.sucursal_id and ct.nombre = 'Cuenta 1'
  );

-- ── PASO 5: canales_medios_pago (SIN filas — 0 mapeos = legacy) ──
create table if not exists canales_medios_pago (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  sucursal_id uuid not null references sucursales(id),
  canal text not null check (canal in ('KIOSK','DELIVERY','MESA','TAKEAWAY','CAJA')),
  medio text not null check (medio in ('TRANSFERENCIA','MERCADO_PAGO')),
  mp_credencial_id uuid,
  transferencia_cuenta_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Integridad por medio (§7): explícito, jamás polimórfico ni mezclado
  constraint chk_medio_cuenta check (
    (medio = 'MERCADO_PAGO' and mp_credencial_id is not null and transferencia_cuenta_id is null)
    or
    (medio = 'TRANSFERENCIA' and transferencia_cuenta_id is not null and mp_credencial_id is null)
  ),
  -- V1: una cuenta por medio por canal
  unique (sucursal_id, canal, medio),
  -- TENANT a nivel DB (§8): FK compuestas — la cuenta referenciada DEBE ser
  -- de la MISMA empresa que el mapeo. Imposible cruzar empresas aunque el
  -- cliente mande UUIDs ajenos coherentes.
  constraint fk_mapeo_mp foreign key (mp_credencial_id, empresa_id)
    references mp_credenciales (id, empresa_id),
  constraint fk_mapeo_transferencia foreign key (transferencia_cuenta_id, empresa_id)
    references cuentas_transferencia (id, empresa_id)
);
-- NOTA §8: la exclusividad por SUCURSAL (cuenta de sucursal B no asignable a
-- sucursal A; cuenta de marca sí asignable) es una regla con NULL semántico
-- que no se expresa limpia como FK — queda a cargo de la validación
-- server-side del route de mapeos (Fase 6) y del resolver (Fase 2), mismo
-- patrón crear_pedido_stock v1.1. Documentado para el informe.

-- ── PASO 6: snapshot en pedidos (FK reales, nullable) ──
alter table pedidos
  add column if not exists mp_credencial_id uuid references mp_credenciales(id),
  add column if not exists transferencia_cuenta_id uuid references cuentas_transferencia(id);

-- ── PASO 8: RLS (patrón de la casa) ──
alter table cuentas_transferencia enable row level security;
alter table canales_medios_pago enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cuentas_transferencia' and policyname = 'admin_cuentas_transferencia') then
    create policy admin_cuentas_transferencia on cuentas_transferencia
      for all using (empresa_id = auth_empresa_id()) with check (empresa_id = auth_empresa_id());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'canales_medios_pago' and policyname = 'admin_canales_medios_pago') then
    create policy admin_canales_medios_pago on canales_medios_pago
      for all using (empresa_id = auth_empresa_id()) with check (empresa_id = auth_empresa_id());
  end if;
end $$;
-- mp_credenciales, sucursal_pagos, pedidos, pedido_pagos: SIN CAMBIOS de RLS (§12).

-- ── PASO 9: VERIFICACIONES (pegar TODO el resultado para el informe) ──
select 'DESPUÉS mp_credenciales' as v, count(*) as filas,
       count(*) filter (where access_token is not null) as con_token,
       count(*) filter (where nombre = 'Cuenta principal') as nombre_default,
       count(*) filter (where activo) as activas
from mp_credenciales;

select 'DESPUÉS índices únicos mp_credenciales' as v, indexrelid::regclass::text as indice
from pg_index where indrelid = 'mp_credenciales'::regclass and indisunique;

select 'Cuentas transferencia migradas' as v, count(*) as total,
       count(*) filter (where alias is not null) as con_alias,
       count(*) filter (where cbu is not null) as con_cbu
from cuentas_transferencia;

select 'Mapeos (debe ser 0)' as v, count(*) from canales_medios_pago;

select 'Snapshot en pedidos' as v, column_name from information_schema.columns
where table_name = 'pedidos' and column_name in ('mp_credencial_id','transferencia_cuenta_id');

select 'RLS nuevas tablas' as v, tablename, policyname, cmd from pg_policies
where tablename in ('cuentas_transferencia','canales_medios_pago');

-- FEDERAL específico (§16):
select 'FEDERAL' as v,
  (select count(*) from canales_medios_pago cmp join empresas e on e.id = cmp.empresa_id where e.slug = 'federal') as mapeos_debe_ser_0,
  (select count(*) from mp_credenciales mc join empresas e on e.id = mc.empresa_id where e.slug = 'federal' and mc.access_token is not null) as credenciales_con_token,
  (select count(*) from cuentas_transferencia ct join empresas e on e.id = ct.empresa_id where e.slug = 'federal') as cuentas_transferencia_migradas,
  (select count(*) from sucursal_pagos sp join empresas e on e.id = sp.empresa_id where e.slug = 'federal' and coalesce(sp.cbu_transferencia,'') <> '') as sucursal_pagos_intacta;
