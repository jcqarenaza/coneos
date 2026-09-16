-- CICLO A — Horario general de sucursal (el TECHO)
-- Contrato (orden CTO): null = SIN restricción (jamás "cerrado").
alter table sucursales add column if not exists horario_general jsonb null;
alter table sucursales add column if not exists mensaje_cerrado text null;
alter table sucursales add column if not exists tolerancia_cierre integer null;
select 'ciclo A ok' as listo;
