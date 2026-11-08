-- Reversión de devolver-stock-pedido.sql. Solo elimina la función nueva; el endpoint
-- debe volver a la versión anterior de /api/pedidos/eliminar ANTES de correr esto.
DROP FUNCTION IF EXISTS public.devolver_stock_pedido(uuid, uuid);
