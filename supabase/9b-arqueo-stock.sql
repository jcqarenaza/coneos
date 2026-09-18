-- 9b — ARQUEO DE STOCK · GO CTO 19/09 (conteo ciego, delta-desde-snapshot)
create table if not exists arqueos_stock (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null, sucursal_id uuid not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','confirmado','descartado')),
  alcance text not null,
  contado_por text, confirmado_por text, observaciones text,
  created_at timestamptz not null default now(), confirmado_at timestamptz
);
create table if not exists arqueo_items (
  id uuid primary key default gen_random_uuid(),
  arqueo_id uuid not null references arqueos_stock(id) on delete cascade,
  producto_id uuid not null,
  teorico numeric not null, fisico numeric not null,
  diferencia numeric generated always as (fisico - teorico) stored,
  ajustado boolean not null default false, descartado boolean not null default false
);
alter table arqueos_stock enable row level security;
alter table arqueo_items enable row level security;
create policy arq_all on arqueos_stock for all using (true) with check (true);
create policy arqi_all on arqueo_items for all using (true) with check (true);
select '9b ok' as listo;
