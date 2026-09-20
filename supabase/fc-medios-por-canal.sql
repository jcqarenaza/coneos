-- ═══════════════════════════════════════════════════════════════════
-- F-C — MEDIOS DE PAGO POR CANAL (orden CTO 20/09)
-- Efectivo y transferencia pasan a la matriz por canal, espejo del
-- modelo existente de MP. DEFAULT TRUE = comportamiento histórico:
-- ninguna sucursal cambia nada hasta que alguien apague una llave.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════
alter table sucursal_pagos add column if not exists acepta_efectivo_kiosk boolean not null default true;
alter table sucursal_pagos add column if not exists acepta_efectivo_delivery boolean not null default true;
alter table sucursal_pagos add column if not exists acepta_efectivo_mesa boolean not null default true;
alter table sucursal_pagos add column if not exists acepta_efectivo_takeaway boolean not null default true;
alter table sucursal_pagos add column if not exists acepta_transferencia_kiosk boolean not null default true;
alter table sucursal_pagos add column if not exists acepta_transferencia_delivery boolean not null default true;
alter table sucursal_pagos add column if not exists acepta_transferencia_mesa boolean not null default true;
alter table sucursal_pagos add column if not exists acepta_transferencia_takeaway boolean not null default true;

select 'fc-medios-por-canal ok' as resultado;
