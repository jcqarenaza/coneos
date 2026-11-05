-- ============================================================
-- STOCK V2 FACTOR — migración de constraints (NO APLICAR sin GO del CTO)
-- Decisión CTO: el factor es entero >= 1. Las columnas ya existen en la base
-- (presentaciones.factor_stock numeric NOT NULL default 1 con check > 0;
-- pedido_items.factor_stock_snap numeric NULL). Estado verificado el 4/11:
-- 198 presentaciones con factor 1 y 0 ítems con snapshot.
-- No se cambia el TIPO de columna (evita reescribir tablas y dependencias):
-- se refuerza con CHECK, en dos pasos (NOT VALID + VALIDATE) para no tomar
-- locks largos.
-- ============================================================
set lock_timeout = '3s';

alter table public.presentaciones
  add constraint presentaciones_factor_stock_entero
  check (factor_stock = trunc(factor_stock) and factor_stock >= 1) not valid;
alter table public.presentaciones validate constraint presentaciones_factor_stock_entero;

alter table public.pedido_items
  add constraint pedido_items_factor_stock_snap_entero
  check (factor_stock_snap is null or (factor_stock_snap = trunc(factor_stock_snap) and factor_stock_snap >= 1)) not valid;
alter table public.pedido_items validate constraint pedido_items_factor_stock_snap_entero;

select 'stock-v2-factor-migracion ok' as listo;
