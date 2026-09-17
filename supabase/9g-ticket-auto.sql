-- 9g — Ticket automático (calco del patrón comanda certificado en 9c)
alter table pedidos add column if not exists ticket_impreso_at timestamptz null;
alter table sucursales add column if not exists ticket_auto boolean not null default false;
select '9g ok' as listo;
