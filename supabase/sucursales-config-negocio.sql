-- CICLO SUCURSALES · extra 23/09 (JC): costo 0 de delivery es ambiguo.
-- El comercio elige qué significa: incluido (default, inercia) o al cadete.
alter table delivery_config add column if not exists envio_al_cadete boolean not null default false;
