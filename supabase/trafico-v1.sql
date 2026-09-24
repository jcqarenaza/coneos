-- CICLO TRÁFICO V1 (GO CTO 24/09) — los dos SQL aprobados.

-- SQL 1 · visitas_canal: adquisición (first-known, jamás se pisa) e identidad multi-tenant.
alter table visitas_canal add column if not exists referrer text;
alter table visitas_canal add column if not exists utm jsonb;
-- La clave lógica real es empresa+visitante+fecha+canal (el bug: la app
-- matcheaba sin empresa). El índice único sella la identidad en la base.
create unique index if not exists visitas_canal_identidad
  on visitas_canal (empresa_id, visitante_id, fecha, canal);

-- SQL 2 · pedidos: continuidad anónima por persona (B). Nullable, sin FK,
-- jamás obligatorio — el tracking es best-effort, nunca bloquea un pedido.
alter table pedidos add column if not exists visitante_id text;
