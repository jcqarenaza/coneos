-- CICLO 3: costo de servicio de retiro para Take Away (aderezos, salsas, packaging)
-- Configurable desde la casa Servicios y horarios. El cobro en el checkout de TA
-- se cablea en un paso posterior explícito — hasta entonces es solo configuración.
alter table takeaway_config add column if not exists costo_servicio numeric not null default 0;
