-- ═══════════════════════════════════════════════════════════════════
-- CICLO 2 — ENTRADA ÚNICA DE PEDIDOS (GO CTO 21/09)
-- Toggle por empresa, DEFAULT FALSE: nace apagada para TODOS.
-- Federal queda OFF por contrato hasta decisión JC+Lucía.
-- Con false, la ruta /pedidos/ es inalcanzable (gate server-side).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════
alter table empresa_config add column if not exists entrada_unificada boolean not null default false;
select 'ciclo2-entrada-unificada ok' as resultado;
