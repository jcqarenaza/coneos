-- ═══════════════════════════════════════════════════════════════════
-- REALTIME CATÁLOGO — LIBRO DE VERSIONES (orden CTO 19/09)
-- Patrón: cambio → bump (misma transacción) → Realtime avisa →
-- kiosk refetch en reposo → el endpoint sigue siendo la verdad.
-- Idempotente: se puede correr más de una vez.
-- ═══════════════════════════════════════════════════════════════════

-- 1) La tabla: una fila por sucursal
create table if not exists catalogo_version (
  sucursal_id uuid primary key references sucursales(id) on delete cascade,
  empresa_id uuid not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

-- Semilla: una fila por cada sucursal existente
insert into catalogo_version (sucursal_id, empresa_id)
select id, empresa_id from sucursales
on conflict (sucursal_id) do nothing;

-- 2) Funciones de bump — corren DENTRO de la transacción del cambio
--    (comportamiento nativo de triggers PG: si el bump falla, el cambio
--    rollbackea; cambio e invalidación viajan juntos — condición CTO).

-- Bump de UNA sucursal (upsert por si la fila no existe todavía)
create or replace function bump_catalogo_sucursal(p_sucursal uuid, p_empresa uuid)
returns void language plpgsql as $$
begin
  insert into catalogo_version (sucursal_id, empresa_id, version, updated_at)
  values (p_sucursal, p_empresa, 1, now())
  on conflict (sucursal_id)
  do update set version = catalogo_version.version + 1, updated_at = now();
end $$;

-- Bump de TODAS las sucursales de una empresa
create or replace function bump_catalogo_empresa(p_empresa uuid)
returns void language plpgsql as $$
begin
  update catalogo_version set version = version + 1, updated_at = now()
  where empresa_id = p_empresa;
  -- sucursales sin fila (creadas antes de la semilla o futuras): sembrar
  insert into catalogo_version (sucursal_id, empresa_id)
  select id, empresa_id from sucursales
  where empresa_id = p_empresa
  on conflict (sucursal_id) do nothing;
end $$;

-- Trigger genérico: decide alcance según qué columnas tiene la fila.
-- Tablas POR SUCURSAL (tienen sucursal_id) → bump de esa sucursal.
-- Tablas POR EMPRESA (solo empresa_id)     → bump de toda la empresa.
create or replace function trg_bump_catalogo()
returns trigger language plpgsql as $$
declare
  r record;
  v_suc uuid;
  v_emp uuid;
begin
  r := coalesce(new, old);
  -- to_jsonb para leer columnas sin asumir el tipo de tabla
  v_suc := nullif(to_jsonb(r)->>'sucursal_id', '')::uuid;
  v_emp := nullif(to_jsonb(r)->>'empresa_id', '')::uuid;
  if v_suc is not null then
    perform bump_catalogo_sucursal(v_suc, v_emp);
  elsif v_emp is not null then
    perform bump_catalogo_empresa(v_emp);
  end if;
  return coalesce(new, old);
end $$;

-- 3) Colgar el trigger de las 10 fuentes (9 del endpoint + empresa_config,
--    incluida por orden CTO: logo/colores/mensaje también son catálogo visual).
do $$
declare
  t text;
begin
  foreach t in array array[
    'categorias', 'productos', 'presentaciones', 'grupos_opciones',
    'opciones', 'inventario_opciones', 'presentacion_grupos',
    'sucursal_catalogo_config', 'producto_stock', 'empresa_config'
  ] loop
    execute format('drop trigger if exists bump_catalogo on %I', t);
    execute format(
      'create trigger bump_catalogo after insert or update or delete on %I
       for each row execute function trg_bump_catalogo()', t);
  end loop;
end $$;

-- 4) Realtime + RLS: la fila no expone datos (un número y una fecha),
--    lectura pública para que el kiosk anónimo pueda suscribirse.
alter table catalogo_version enable row level security;
drop policy if exists catalogo_version_read on catalogo_version;
create policy catalogo_version_read on catalogo_version for select using (true);

do $$ begin
  alter publication supabase_realtime add table catalogo_version;
exception when duplicate_object then null; end $$;

select 'realtime-catalogo ok' as resultado;
