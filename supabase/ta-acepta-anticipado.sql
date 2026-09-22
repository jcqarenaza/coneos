-- TA ANTICIPADO — la llave por sucursal (regla 5: lo nuevo nace OFF).
-- ON: con el TA cerrado pero con slots del día por delante, la vidriera
-- acepta pedidos que entran ya (primer slot automático si no eligió hora).
alter table takeaway_config add column if not exists acepta_anticipado boolean not null default false;
