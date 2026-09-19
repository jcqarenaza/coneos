-- ═══════════════════════════════════════════════════════════════════
-- REALTIME PEDIDOS — LIBRO DE VERSIONES (Etapa 2, orden CTO 19/09)
-- pedidos cambia → pedidos_version++ (misma transacción) → Realtime
-- avisa → invalidación → /api/operacion/consulta reconstruye → UI.
-- Calcado del libro de catálogo certificado hoy. Idempotente.
-- SECURITY DEFINER desde el día uno (lección del ciclo catálogo).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists pedidos_version (
  sucursal_id uuid primary key references sucursales(id) on delete cascade,
  empresa_id uuid not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

insert into pedidos_version (sucursal_id, empresa_id)
select id, empresa_id from sucursales
on conflict (sucursal_id) do nothing;

create or replace function bump_pedidos_sucursal(p_sucursal uuid, p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into pedidos_version (sucursal_id, empresa_id, version, updated_at)
  values (p_sucursal, p_empresa, 1, now())
  on conflict (sucursal_id)
  do update set version = pedidos_version.version + 1, updated_at = now();
end $$;

create or replace function trg_bump_pedidos()
returns trigger language plpgsql as $$
declare
  r record;
begin
  r := coalesce(new, old);
  if r.sucursal_id is not null then
    perform bump_pedidos_sucursal(r.sucursal_id, r.empresa_id);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists bump_pedidos on pedidos;
create trigger bump_pedidos after insert or update or delete on pedidos
  for each row execute function trg_bump_pedidos();

alter table pedidos_version enable row level security;
drop policy if exists pedidos_version_read on pedidos_version;
create policy pedidos_version_read on pedidos_version for select using (true);

do $$ begin
  alter publication supabase_realtime add table pedidos_version;
exception when duplicate_object then null; end $$;

select 'realtime-pedidos ok' as resultado;
