-- ============================================================================
-- MULTI-FOTOS · 01 CORRECCIÓN  (productos + presentaciones)
-- ----------------------------------------------------------------------------
-- ESTADO: PROPUESTA. NO ejecutar sin GO específico del CTO (base compartida
--         LAB + producción). Probado solo en PostgreSQL aislado (ver tests/).
-- CÓMO: pegar completo en Supabase SQL Editor. Es UNA transacción: si algo
--       falla, no queda nada a medias.
-- ADITIVO: no modifica tablas, policies ni permisos existentes. Solo crea
--          objetos nuevos y copia (INSERT) las imágenes actuales.
-- COMPAT:  productos.imagen_url y presentaciones.imagen_url se mantienen y
--          pasan a ser un espejo de la foto principal (los 17 usos siguen).
-- REVERSIÓN: 02-multi-fotos-reversion.sql
-- ============================================================================
begin;

-- Pre-chequeo: no correr dos veces ni sobre una tabla homónima ajena.
do $$ begin
  if to_regclass('public.producto_imagenes') is not null then
    raise exception 'producto_imagenes ya existe: abortar (revisar antes de continuar)';
  end if;
end $$;

-- 1. TABLA ------------------------------------------------------------------
create table public.producto_imagenes (
  id              uuid        primary key default gen_random_uuid(),
  empresa_id      uuid        not null references public.empresas(id) on delete cascade,
  producto_id     uuid        not null,
  presentacion_id uuid        references public.presentaciones(id) on delete cascade,
  url             text        not null check (length(url) between 10 and 2048 and url ~ '^https?://'),
  orden           integer     not null default 0,
  es_principal    boolean     not null default false,
  created_at      timestamptz not null default now(),
  -- Integridad producto↔empresa (usa el UNIQUE(id, empresa_id) que ya existe en productos)
  constraint producto_imagenes_producto_empresa_fk
    foreign key (producto_id, empresa_id) references public.productos (id, empresa_id) on delete cascade
);

create index producto_imagenes_ambito_idx
  on public.producto_imagenes (producto_id, presentacion_id, orden, created_at);

create index producto_imagenes_empresa_idx
  on public.producto_imagenes (empresa_id);

-- Una sola principal por ámbito (producto o presentación). Red de seguridad:
-- la regla la mantiene el trigger; el índice garantiza que nunca haya dos.
create unique index producto_imagenes_una_principal_por_ambito
  on public.producto_imagenes (producto_id, coalesce(presentacion_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where es_principal;

-- 2. PERMISOS + RLS (mismo patrón que productos/presentaciones) -------------
revoke all on public.producto_imagenes from public, anon;
revoke truncate, references, trigger on public.producto_imagenes from authenticated;
grant select, insert, update, delete on public.producto_imagenes to authenticated;
grant all on public.producto_imagenes to service_role;

alter table public.producto_imagenes enable row level security;

create policy admin_producto_imagenes on public.producto_imagenes
  for all to authenticated
  using      (empresa_id = auth_empresa_id())
  with check (empresa_id = auth_empresa_id());
-- Sin lectura anon: el catálogo público sale por /api/kiosk/catalogo (service_role).

-- 3. MIGRACIÓN DE DATOS: la imagen actual pasa a ser la principal -----------
--    (antes de crear los triggers: no toca productos/presentaciones)
insert into public.producto_imagenes (empresa_id, producto_id, presentacion_id, url, orden, es_principal)
select p.empresa_id, p.id, null, btrim(p.imagen_url), 0, true
  from public.productos p
 where p.imagen_url is not null and btrim(p.imagen_url) <> '';

insert into public.producto_imagenes (empresa_id, producto_id, presentacion_id, url, orden, es_principal)
select pr.empresa_id, pr.producto_id, pr.id, btrim(pr.imagen_url), 0, true
  from public.presentaciones pr
 where pr.imagen_url is not null and btrim(pr.imagen_url) <> '';

-- 4. TRIGGERS ---------------------------------------------------------------
-- Todas las funciones son SECURITY INVOKER (corren con los permisos de quien
-- escribe, bajo RLS): no elevan privilegios, no hay nada que abusar.
-- search_path fijo. pg_trigger_depth() > 1 = llamada anidada (la propia
-- función moviendo la principal, o una cascada de FK): se omite.

-- 4-0. Serialización de escrituras de fotos (BEFORE STATEMENT) ----------------
-- PostgreSQL bloquea la fila de la foto ANTES de ejecutar los triggers de fila.
-- Si dos admins tocan fotos del mismo producto a la vez, "foto → padre" de uno
-- puede cruzarse con "padre → foto" del otro (deadlock; hallado en test T29).
-- Solución: un lock transaccional ANTES de tocar ninguna fila. Las escrituras de
-- fotos son tareas de admin (pocas, de milisegundos), así que serializarlas no
-- tiene costo apreciable. Las ediciones normales del catálogo NO lo toman.
-- pg_trigger_depth() > 1 (dentro de un trigger, el propio cuenta 1) = llamada anidada o cascada de FK: se omite (la cascada
-- de un DELETE de producto no debe tomar este lock después de bloquear el padre).
create or replace function public.fn_producto_imagenes_lock()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() = 1 then
    perform pg_advisory_xact_lock(hashtextextended('public.producto_imagenes', 7));
  end if;
  return null;
end $$;

create trigger a00_producto_imagenes_lock
  before insert or update or delete on public.producto_imagenes
  for each statement execute function public.fn_producto_imagenes_lock();

-- 4a. Validación + reglas de principal + límite de 10 (BEFORE) ---------------
create or replace function public.fn_producto_imagenes_validar()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_n    integer;
  v_pres record;
begin
  if pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  -- ORDEN DE LOCKS (evita deadlocks con ediciones normales del catálogo):
  -- SIEMPRE primero la fila padre (la que el espejo imagen_url va a tocar) y
  -- recién después catalogo_version. Es el mismo orden de un UPDATE de
  -- productos/presentaciones. Sin esto, el bump de catalogo_version quedaba
  -- antes que el lock del padre → inversión → deadlock (hallado en test T29).
  if tg_op = 'DELETE' then
    if old.presentacion_id is null then
      perform 1 from public.productos where id = old.producto_id for no key update;
    else
      perform 1 from public.presentaciones where id = old.presentacion_id for no key update;
    end if;
    return old;
  end if;
  if new.presentacion_id is null then
    perform 1 from public.productos where id = new.producto_id for no key update;
  else
    perform 1 from public.presentaciones where id = new.presentacion_id for no key update;
  end if;

  if tg_op = 'UPDATE' then
    if new.empresa_id is distinct from old.empresa_id
       or new.producto_id is distinct from old.producto_id
       or new.presentacion_id is distinct from old.presentacion_id then
      raise exception 'IMAGEN_PROPIEDAD_INMUTABLE' using errcode = 'P0001';
    end if;
    if old.es_principal and not new.es_principal then
      -- Para cambiar la principal se marca OTRA como principal.
      raise exception 'IMAGEN_PRINCIPAL_REQUERIDA' using errcode = 'P0001';
    end if;
    if new.es_principal and not old.es_principal then
      -- Mismo statement, misma transacción: el cambio de principal es atómico.
      update public.producto_imagenes
         set es_principal = false
       where producto_id = new.producto_id
         and presentacion_id is not distinct from new.presentacion_id
         and es_principal and id <> new.id;
    end if;
    return new;
  end if;

  -- INSERT
  if new.presentacion_id is not null then
    select producto_id, empresa_id into v_pres from public.presentaciones where id = new.presentacion_id;
    if not found or v_pres.producto_id <> new.producto_id or v_pres.empresa_id <> new.empresa_id then
      raise exception 'PRESENTACION_INVALIDA' using errcode = 'P0001';
    end if;
  end if;

  -- Serializa altas concurrentes del MISMO ámbito (límite exacto, una principal).

  select count(*) into v_n
    from public.producto_imagenes
   where producto_id = new.producto_id
     and presentacion_id is not distinct from new.presentacion_id;

  if v_n >= 10 then
    raise exception 'LIMITE_IMAGENES' using errcode = 'P0001';
  end if;

  if v_n = 0 then
    new.es_principal := true;                 -- la primera siempre es la principal
  elsif new.es_principal then
    update public.producto_imagenes           -- una nueva principal reemplaza a la anterior
       set es_principal = false
     where producto_id = new.producto_id
       and presentacion_id is not distinct from new.presentacion_id
       and es_principal;
  end if;
  return new;
end $$;

create trigger a05_producto_imagenes_validar
  before insert or update or delete on public.producto_imagenes
  for each row execute function public.fn_producto_imagenes_validar();

-- 4b. Si se borra la principal, se promueve la siguiente (AFTER DELETE) ------
create or replace function public.fn_producto_imagenes_promover()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 or not old.es_principal then
    return null;
  end if;
  update public.producto_imagenes
     set es_principal = true
   where id = (select id from public.producto_imagenes
                where producto_id = old.producto_id
                  and presentacion_id is not distinct from old.presentacion_id
                order by orden, created_at, id
                limit 1)
     and not exists (select 1 from public.producto_imagenes
                      where producto_id = old.producto_id
                        and presentacion_id is not distinct from old.presentacion_id
                        and es_principal);
  return null;
end $$;

create trigger a10_producto_imagenes_promover
  after delete on public.producto_imagenes
  for each row execute function public.fn_producto_imagenes_promover();

-- 4c. Espejo imagen_url = principal (AFTER) -----------------------------------
--     Va ANTES (por nombre) que bump_catalogo: el orden de locks queda
--     productos/presentaciones → catalogo_version, igual que un UPDATE normal
--     de esas tablas (sin inversión → sin riesgo de deadlock nuevo).
create or replace function public.fn_producto_imagenes_sync()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  r     record;
  v_url text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  r := coalesce(new, old);
  select url into v_url
    from public.producto_imagenes
   where producto_id = r.producto_id
     and presentacion_id is not distinct from r.presentacion_id
     and es_principal
   limit 1;
  if r.presentacion_id is null then
    update public.productos set imagen_url = v_url
     where id = r.producto_id and imagen_url is distinct from v_url;
  else
    update public.presentaciones set imagen_url = v_url
     where id = r.presentacion_id and imagen_url is distinct from v_url;
  end if;
  return null;
end $$;

create trigger a20_producto_imagenes_sync
  after insert or update or delete on public.producto_imagenes
  for each row execute function public.fn_producto_imagenes_sync();

-- 4d. Refresco de catálogo (el mismo trigger que usan productos/presentaciones)
create trigger bump_catalogo
  after insert or update or delete on public.producto_imagenes
  for each row execute function public.trg_bump_catalogo();

-- 5. RPC (SECURITY INVOKER, bajo RLS) ------------------------------------------
create or replace function public.set_imagen_principal(p_imagen_id uuid)
returns void language plpgsql security invoker
set search_path = public, pg_temp
as $$
begin
  update public.producto_imagenes set es_principal = true where id = p_imagen_id;
  if not found then
    raise exception 'IMAGEN_NO_ENCONTRADA' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.reordenar_imagenes(p_producto_id uuid, p_presentacion_id uuid, p_ids uuid[])
returns void language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare v_total integer; v_ok integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('public.producto_imagenes', 7));
  select count(*) into v_total from public.producto_imagenes
   where producto_id = p_producto_id and presentacion_id is not distinct from p_presentacion_id;
  select count(*) into v_ok from public.producto_imagenes
   where producto_id = p_producto_id and presentacion_id is not distinct from p_presentacion_id
     and id = any (p_ids);
  if v_total = 0 or v_total <> coalesce(array_length(p_ids, 1), 0) or v_ok <> v_total then
    raise exception 'ORDEN_INVALIDO' using errcode = 'P0001';
  end if;
  update public.producto_imagenes pi
     set orden = x.pos - 1
    from unnest(p_ids) with ordinality as x(id, pos)
   where pi.id = x.id and pi.orden is distinct from x.pos - 1;
end $$;

revoke all on function public.fn_producto_imagenes_lock()     from public, anon, authenticated;
revoke all on function public.fn_producto_imagenes_validar()  from public, anon, authenticated;
revoke all on function public.fn_producto_imagenes_promover() from public, anon, authenticated;
revoke all on function public.fn_producto_imagenes_sync()     from public, anon, authenticated;
revoke all on function public.set_imagen_principal(uuid)      from public, anon;
revoke all on function public.reordenar_imagenes(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.set_imagen_principal(uuid)   to authenticated, service_role;
grant execute on function public.reordenar_imagenes(uuid, uuid, uuid[]) to authenticated, service_role;

-- 6. VERIFICACIÓN FINAL (cualquier diferencia aborta TODA la transacción) -------
do $$
declare v_n integer;
begin
  -- 6a. Cantidades: cada foto no vacía del origen tiene exactamente una principal
  select count(*) into v_n from (
    select count(*) filter (where imagen_url is not null and btrim(imagen_url) <> '') a from public.productos) x
   where a <> (select count(*) from public.producto_imagenes where presentacion_id is null and es_principal);
  if v_n > 0 then raise exception 'MIGRACION_DESCUADRADA: cantidad de principales de PRODUCTOS'; end if;

  select count(*) into v_n from (
    select count(*) filter (where imagen_url is not null and btrim(imagen_url) <> '') a from public.presentaciones) x
   where a <> (select count(*) from public.producto_imagenes where presentacion_id is not null and es_principal);
  if v_n > 0 then raise exception 'MIGRACION_DESCUADRADA: cantidad de principales de PRESENTACIONES'; end if;

  -- 6b. PRODUCTOS: imagen_url = url de su principal (en ambos sentidos)
  if exists (select 1 from public.productos p
              where p.imagen_url is not null and btrim(p.imagen_url) <> ''
                and not exists (select 1 from public.producto_imagenes i
                                 where i.producto_id = p.id and i.presentacion_id is null
                                   and i.es_principal and i.url = btrim(p.imagen_url))) then
    raise exception 'IMAGEN_URL_DESINCRONIZADA (productos): hay un producto cuya imagen_url no coincide con su foto principal';
  end if;
  if exists (select 1 from public.producto_imagenes i
              where i.presentacion_id is null and i.es_principal
                and not exists (select 1 from public.productos p
                                 where p.id = i.producto_id and p.empresa_id = i.empresa_id
                                   and btrim(coalesce(p.imagen_url, '')) = i.url)) then
    raise exception 'IMAGEN_URL_DESINCRONIZADA (productos): hay una principal sin producto coincidente';
  end if;

  -- 6c. PRESENTACIONES: imagen_url = url de su principal (en ambos sentidos)
  if exists (select 1 from public.presentaciones pr
              where pr.imagen_url is not null and btrim(pr.imagen_url) <> ''
                and not exists (select 1 from public.producto_imagenes i
                                 where i.presentacion_id = pr.id and i.producto_id = pr.producto_id
                                   and i.es_principal and i.url = btrim(pr.imagen_url))) then
    raise exception 'IMAGEN_URL_DESINCRONIZADA (presentaciones): hay una presentación cuya imagen_url no coincide con su foto principal';
  end if;
  if exists (select 1 from public.producto_imagenes i
              where i.presentacion_id is not null and i.es_principal
                and not exists (select 1 from public.presentaciones pr
                                 where pr.id = i.presentacion_id and pr.producto_id = i.producto_id
                                   and pr.empresa_id = i.empresa_id
                                   and btrim(coalesce(pr.imagen_url, '')) = i.url)) then
    raise exception 'IMAGEN_URL_DESINCRONIZADA (presentaciones): hay una principal sin presentación coincidente';
  end if;

  -- 6d. Ningún ámbito con fotos queda sin principal, ni con más de una
  if exists (select 1 from public.producto_imagenes
              group by producto_id, presentacion_id
             having count(*) filter (where es_principal) <> 1) then
    raise exception 'PRINCIPAL_INVALIDA: algún ámbito no tiene exactamente una principal';
  end if;
end $$;

commit;
