-- Reversión de pedidos-repetidos.sql. Antes: volver el código (api/pedidos y clientes) a la versión anterior.
-- Pierde el registro de operaciones recientes y la configuración por empresa (no toca pedidos ni stock).
drop function if exists public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean);
drop function if exists public.completar_operacion_pedido(uuid,uuid,uuid);
drop function if exists public.liberar_operacion_pedido(uuid,uuid);
drop table if exists public.pedido_operaciones;
alter table public.empresa_config drop constraint if exists empresa_config_pedidos_repetidos_minutos_pos;
alter table public.empresa_config drop column if exists pedidos_repetidos_minutos;
alter table public.empresa_config drop column if exists prevenir_pedidos_repetidos;
