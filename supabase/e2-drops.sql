-- ============================================================
-- E2 — DROPS · GO CTO 17/09/2026
-- ⚠️ ORDEN: correr SOLO DESPUÉS del merge+deploy de E2 (el código
-- que tocaba comprobantes ya retirado) — jamás antes.
-- Evidencia por objeto: 0 filas + 0 refs + reemplazo identificado.
-- ============================================================
alter table pedidos drop column if exists tipo_tarjeta;  -- nació y murió en 9c
drop table if exists turnos;        -- turnos de caja, intento previo, jamás usada
drop table if exists promociones;   -- reemplazada por beneficios_config
drop table if exists audit_log;     -- jamás escrita (pedido_estados_log es el log real)
drop table if exists clientes;      -- reemplazada por clientes_beneficios
drop table if exists pagos;         -- reemplazada por pedido_pagos
drop table if exists comprobantes;  -- legacy ROTA: insert fallaba en silencio, sin lectores;
                                    -- el registro real vive en el flujo de facturación
select 'e2 drops ok' as listo;
