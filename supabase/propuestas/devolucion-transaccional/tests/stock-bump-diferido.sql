-- ══════════════════════════════════════════════════════════════════════
-- STOCK · bump_catalogo DIFERIDO al COMMIT para producto_stock
-- Rama: fix/compras-orden-lineas · Orden CTO 4/11/2026 (punto 1, hallazgo)
-- NO APLICAR sin GO productivo del CTO.
--
-- PROBLEMA: el trigger bump_catalogo (AFTER ROW) de producto_stock toma la
--   fila de catalogo_version de la sucursal en el PRIMER UPDATE de stock y la
--   retiene hasta el commit. Todo escritor queda con la secuencia
--   "fila de producto → catalogo_version → fila de producto…". Dos escritores
--   que se crucen (venta/compra/ajuste/arqueo/devolución) forman un ciclo
--   aunque ambos ordenen por producto_id (ver INFORME-COMPRAS.md, casos S_b
--   y S_ajustar).
-- SOLUCIÓN: mismo trigger y misma función, pero CONSTRAINT TRIGGER
--   DEFERRABLE INITIALLY DEFERRED. El bump corre al COMMIT, cuando ya se
--   tienen TODAS las filas de producto: catalogo_version pasa a ser el último
--   lock de la transacción y deja de poder cerrar un ciclo. Además se retiene
--   milisegundos en vez de toda la transacción.
-- NO cambia: la RPC de venta aprobada, Compras, precios, pagos, ARCA.
-- SEMÁNTICA: la versión sube en el mismo commit que el stock (nadie la ve
--   antes de que el stock sea visible); realtime sigue disparando.
--
-- REVERSIÓN: stock-bump-diferido-REVERSION.sql
-- ══════════════════════════════════════════════════════════════════════
set lock_timeout = '3s';
begin;
drop trigger if exists bump_catalogo on public.producto_stock;
create constraint trigger bump_catalogo
  after insert or delete or update on public.producto_stock
  deferrable initially deferred
  for each row execute function public.trg_bump_catalogo();
commit;
