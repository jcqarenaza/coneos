-- PAQUETE CANALES VISIBLES + DELIVERY PROGRAMADO V1 (espec/orden JC 22/09)
-- Defaults preservan TODO el comportamiento actual. Federal queda igual.
alter table delivery_config add column if not exists mostrar_en_app boolean not null default true;
alter table takeaway_config add column if not exists mostrar_en_app boolean not null default true;
-- Delivery programado: llave OFF por defecto (regla 5). Reutiliza pedidos.hora_retiro.
alter table delivery_config add column if not exists permitir_programado boolean not null default false;
