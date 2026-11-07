-- ============================================================================
-- MULTI-FOTOS · 02 REVERSIÓN  (respaldos acumulativos)
-- ----------------------------------------------------------------------------
-- ESTADO: PROPUESTA. NO ejecutar sin GO específico del CTO.
-- CÓMO: pegar completo en Supabase SQL Editor. Es UNA transacción: si cualquier
--       verificación falla, no se borra nada y no queda ningún respaldo a medias.
--
-- QUÉ HACE
--  1. Bloquea la tabla (nadie escribe fotos mientras se respalda y se borra).
--  2. Crea una CAPTURA independiente: un UUID (respaldo_id) + fecha, con todas
--     las filas de producto_imagenes. Las capturas de ejecuciones anteriores
--     NO se tocan: quedan acumuladas (producto_imagenes_respaldo) y registradas
--     (producto_imagenes_respaldo_log).
--  3. VERIFICA antes de borrar: filas respaldadas = filas de origen, y el
--     contenido es idéntico en ambos sentidos. Si no, aborta (la tabla sigue).
--  4. Elimina triggers, funciones y tabla de multi-fotos.
--  5. Refresca el catálogo de las empresas que tenían fotos (ver NOTA bump).
--
-- NO TOCA productos.imagen_url ni presentaciones.imagen_url: ya contienen la
-- foto principal vigente (la mantiene el trigger de sincronización).
--
-- ACCESO A LOS RESPALDOS: sin permisos para public, anon, authenticated NI
-- service_role (la app no los necesita). Solo el dueño/superusuario (SQL Editor).
-- Para consultar:  select * from public.producto_imagenes_respaldo_log order by respaldado_at;
-- Para restaurar una captura, ver el bloque comentado al final.
--
-- NOTA bump_catalogo_empresa (firma y definición REALES, verificadas por catálogo el 07/11/2026):
--   public.bump_catalogo_empresa(p_empresa uuid) RETURNS void
--   LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--     update catalogo_version set version = version + 1, updated_at = now() where empresa_id = p_empresa;
--     insert into catalogo_version (sucursal_id, empresa_id)
--       select id, empresa_id from sucursales where empresa_id = p_empresa
--       on conflict (sucursal_id) do nothing;
--   Es la MISMA función que ya dispara, por cada fila, el trigger bump_catalogo de
--   productos/presentaciones. Seguridad: solo suma 1 a un contador y siembra filas
--   que faltan para sucursales existentes; no lee ni expone datos.
--   Necesidad: kiosk/delivery/mesa/take away detectan "catálogo cambió" por esa
--   versión. Sin el refresco, un cliente abierto seguiría mostrando el carrusel
--   viejo hasta recargar. Alcance: SOLO las empresas que tenían fotos en la tabla
--   (las demás no cambian de contenido, así que no se les refresca; menos carga).
-- ============================================================================
begin;

do $$ begin
  if to_regclass('public.producto_imagenes') is null then
    raise exception 'producto_imagenes no existe: no hay nada que revertir';
  end if;
end $$;

lock table public.producto_imagenes in access exclusive mode;

-- 1. Tablas de respaldo (se crean una sola vez; las capturas se ACUMULAN) ------
create table if not exists public.producto_imagenes_respaldo (
  respaldo_id     uuid        not null,
  respaldado_at   timestamptz not null,
  id              uuid        not null,
  empresa_id      uuid        not null,
  producto_id     uuid        not null,
  presentacion_id uuid,
  url             text        not null,
  orden           integer     not null,
  es_principal    boolean     not null,
  created_at      timestamptz not null,
  primary key (respaldo_id, id)
);
create table if not exists public.producto_imagenes_respaldo_log (
  respaldo_id   uuid        primary key,
  respaldado_at timestamptz not null,
  filas         integer     not null,
  empresas      integer     not null
);
-- Sin acceso para nadie de la app (incluido service_role).
revoke all on public.producto_imagenes_respaldo     from public, anon, authenticated, service_role;
revoke all on public.producto_imagenes_respaldo_log from public, anon, authenticated, service_role;
alter table public.producto_imagenes_respaldo     enable row level security;
alter table public.producto_imagenes_respaldo_log enable row level security;

-- 2. Captura + verificación ANTES de borrar ------------------------------------
do $$
declare
  v_id  uuid        := gen_random_uuid();
  v_at  timestamptz := now();
  v_src integer;
  v_bak integer;
  v_dif integer;
  v_emp integer;
begin
  select count(*), count(distinct empresa_id) into v_src, v_emp from public.producto_imagenes;

  insert into public.producto_imagenes_respaldo
    (respaldo_id, respaldado_at, id, empresa_id, producto_id, presentacion_id, url, orden, es_principal, created_at)
  select v_id, v_at, i.id, i.empresa_id, i.producto_id, i.presentacion_id, i.url, i.orden, i.es_principal, i.created_at
    from public.producto_imagenes i;

  select count(*) into v_bak from public.producto_imagenes_respaldo where respaldo_id = v_id;
  if v_bak <> v_src then
    raise exception 'RESPALDO_INCOMPLETO: origen % filas, respaldo % filas. Se aborta sin borrar nada.', v_src, v_bak;
  end if;

  select count(*) into v_dif from (
    (select id, empresa_id, producto_id, presentacion_id, url, orden, es_principal, created_at from public.producto_imagenes
     except
     select id, empresa_id, producto_id, presentacion_id, url, orden, es_principal, created_at from public.producto_imagenes_respaldo where respaldo_id = v_id)
    union all
    (select id, empresa_id, producto_id, presentacion_id, url, orden, es_principal, created_at from public.producto_imagenes_respaldo where respaldo_id = v_id
     except
     select id, empresa_id, producto_id, presentacion_id, url, orden, es_principal, created_at from public.producto_imagenes)
  ) d;
  if v_dif <> 0 then
    raise exception 'RESPALDO_DISTINTO: % filas difieren entre origen y respaldo. Se aborta sin borrar nada.', v_dif;
  end if;

  insert into public.producto_imagenes_respaldo_log (respaldo_id, respaldado_at, filas, empresas) values (v_id, v_at, v_src, v_emp);
  perform set_config('multifotos.respaldo_id', v_id::text, true);   -- solo dentro de esta transacción
  raise notice 'RESPALDO % · % filas · % empresas · %', v_id, v_src, v_emp, v_at;
end $$;

-- 3. Eliminación ------------------------------------------------------------------
drop trigger if exists bump_catalogo on public.producto_imagenes;
drop trigger if exists a20_producto_imagenes_sync on public.producto_imagenes;
drop trigger if exists a10_producto_imagenes_promover on public.producto_imagenes;
drop trigger if exists a05_producto_imagenes_validar on public.producto_imagenes;
drop trigger if exists a00_producto_imagenes_lock on public.producto_imagenes;
drop function if exists public.set_imagen_principal(uuid);
drop function if exists public.reordenar_imagenes(uuid, uuid, uuid[]);
drop function if exists public.fn_producto_imagenes_sync();
drop function if exists public.fn_producto_imagenes_promover();
drop function if exists public.fn_producto_imagenes_validar();
drop function if exists public.fn_producto_imagenes_lock();
drop table public.producto_imagenes;

-- 4. Refrescar el catálogo de las empresas que tenían fotos ---------------------
select public.bump_catalogo_empresa(e.empresa_id)
  from (select distinct empresa_id from public.producto_imagenes_respaldo
         where respaldo_id = current_setting('multifotos.respaldo_id')::uuid) e;

-- 5. Verificación final: el respaldo de ESTA ejecución quedó registrado y completo
do $$
declare v_id uuid := current_setting('multifotos.respaldo_id')::uuid;
begin
  if (select filas from public.producto_imagenes_respaldo_log where respaldo_id = v_id)
     <> (select count(*) from public.producto_imagenes_respaldo where respaldo_id = v_id) then
    raise exception 'RESPALDO_INCONSISTENTE tras borrar: se aborta y TODO vuelve atrás';
  end if;
end $$;

-- Resumen de capturas (todas las ejecuciones)
select respaldo_id, respaldado_at, filas, empresas from public.producto_imagenes_respaldo_log order by respaldado_at;

commit;

-- ============================================================================
-- RESTAURAR UNA CAPTURA (solo si hiciera falta; correr 01 primero y luego esto,
-- reemplazando el UUID). Reinserta las fotos de esa captura; los triggers
-- mantienen principal e imagen_url. OJO: 01 ya migró la principal vigente, así que
-- puede haber duplicados y el tope de 10: revisar antes. No es parte de la reversión.
-- ============================================================================
-- insert into public.producto_imagenes (id, empresa_id, producto_id, presentacion_id, url, orden, es_principal, created_at)
-- select id, empresa_id, producto_id, presentacion_id, url, orden, false, created_at
--   from public.producto_imagenes_respaldo
--  where respaldo_id = '<UUID>' and id not in (select id from public.producto_imagenes);
-- -- luego marcar principal con:  select public.set_imagen_principal(id) from ... where es_principal;
-- ============================================================================
