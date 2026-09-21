-- ═══════════════════════════════════════════════════════════════════
-- CICLO 1 — MIGRACIÓN: alias legacy → asignación explícita (Paso 4)
-- Mandato CTO: NO crear cuentas · NO copiar alias · NO tocar sucursal_pagos.
-- Solo INSERTA los mapeos canal→cuenta usando las cuentas EXISTENTES
-- (censo: byte-idénticas al legacy). Idempotente (on conflict do nothing).
-- Reversible: delete from canales_medios_pago deshace todo (el fallback
-- legacy sigue vivo por decisión CTO).
-- ═══════════════════════════════════════════════════════════════════
insert into canales_medios_pago (empresa_id, sucursal_id, canal, medio, transferencia_cuenta_id)
select ct.empresa_id, ct.sucursal_id, c.canal, 'TRANSFERENCIA', ct.id
from cuentas_transferencia ct
cross join (values ('KIOSK'), ('DELIVERY'), ('MESA'), ('TAKEAWAY'), ('CAJA')) as c(canal)
where ct.activo = true
on conflict (sucursal_id, canal, medio) do nothing;

-- Verificación inmediata: debe listar 5 canales por sucursal, cada uno
-- con el alias EXACTO del legacy de esa sucursal
select s.nombre as sucursal, cmp.canal, ct.alias, ct.titular
from canales_medios_pago cmp
join sucursales s on s.id = cmp.sucursal_id
join cuentas_transferencia ct on ct.id = cmp.transferencia_cuenta_id
where cmp.medio = 'TRANSFERENCIA'
order by s.nombre, cmp.canal;
