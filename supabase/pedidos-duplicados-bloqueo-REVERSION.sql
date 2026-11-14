-- ══════════════════════════════════════════════════════════════════════
-- Reversión de pedidos-duplicados-bloqueo.sql (13/11/2026). NO destruye pedidos ni operaciones.
-- Restaura reclamar_operacion_pedido de 8 parámetros con el cuerpo EXACTO de pedidos-repetidos.sql, y borra SOLO lo que marcó el
-- script de bloqueo ('coneos:pedidos-bloqueo-13-11'): la función de 10 parámetros, normalizar_telefono_pedido, el índice, la constraint
-- y las dos columnas de empresa_config (la llave y la ventana en horas; se pierde solo ese valor de configuración).
-- Antes: volver el código (api/pedidos y componente) a la versión anterior. Con el código NUEVO y esta reversión aplicada no hay
-- problema: el servidor lee la llave, no encuentra la columna y llama con 8 parámetros (comportamiento anterior).
-- ══════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
do $rev$
declare r record; m constant text := 'coneos:pedidos-bloqueo-13-11';
begin
  for r in select p.oid::regprocedure as f, obj_description(p.oid,'pg_proc') as c, p.pronargs from pg_proc p
            where p.pronamespace='public'::regnamespace and p.proname='reclamar_operacion_pedido' loop
    if r.pronargs = 10 and r.c = m then execute 'drop function ' || r.f::text;
    else raise notice 'SE CONSERVA la función % (no es la de este script)', r.f; end if;
  end loop;
  for r in select p.oid::regprocedure as f, obj_description(p.oid,'pg_proc') as c from pg_proc p
            where p.pronamespace='public'::regnamespace and p.proname='normalizar_telefono_pedido' loop
    if r.c = m then execute 'drop function ' || r.f::text; else raise notice 'SE CONSERVA la función % (no es de este script)', r.f; end if;
  end loop;
  if to_regclass('public.idx_pedido_operaciones_tel_reciente') is not null then      -- if anidado: plpgsql no garantiza el cortocircuito de AND
    if obj_description(to_regclass('public.idx_pedido_operaciones_tel_reciente'), 'pg_class') = m then
      drop index public.idx_pedido_operaciones_tel_reciente;
    end if;
  end if;
  if exists (select 1 from pg_constraint c where c.conname='empresa_config_pedido_activo_horas_rango' and c.conrelid='public.empresa_config'::regclass)
     and (select obj_description(c.oid,'pg_constraint') from pg_constraint c where c.conname='empresa_config_pedido_activo_horas_rango' and c.conrelid='public.empresa_config'::regclass) = m then
    alter table public.empresa_config drop constraint empresa_config_pedido_activo_horas_rango;
  end if;
  for r in select a.attname::text as col, col_description(a.attrelid, a.attnum) as c from pg_attribute a
            where a.attrelid='public.empresa_config'::regclass and a.attnum > 0 and not a.attisdropped
              and a.attname in ('bloquear_pedidos_duplicados','pedido_activo_ventana_horas') loop
    if r.c = m then execute format('alter table public.empresa_config drop column %I', r.col);
    else raise notice 'SE CONSERVA la columna empresa_config.% (ya existía antes)', r.col; end if;
  end loop;
end $rev$;

-- Función de 8 parámetros: cuerpo EXACTO de pedidos-repetidos.sql (copiado sin cambios)
create or replace function public.reclamar_operacion_pedido(
  p_empresa_id uuid, p_sucursal_id uuid, p_operacion_id uuid, p_huella text,
  p_telefono text, p_visitante text, p_dispositivo_id uuid, p_confirmar boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to pg_catalog, pg_temp
as $function$
declare
  v_activo boolean := true; v_min integer := 30;
  v_op record; v_dup record; v_tel text := nullif(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), '');
  v_vis text := nullif(p_visitante, ''); v_ped_id uuid;
begin
  if p_empresa_id is null or p_sucursal_id is null or p_operacion_id is null or coalesce(p_huella,'') = '' then
    raise exception 'OPERACION_DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  -- Serializa TODO lo que tenga el mismo contenido en la misma sucursal: dos solicitudes
  -- simultáneas (misma operación o dos operaciones iguales) pasan de a una por acá.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_sucursal_id::text || ':' || p_huella, 0));

  select coalesce(prevenir_pedidos_repetidos, true), coalesce(pedidos_repetidos_minutos, 30)
    into v_activo, v_min from public.empresa_config where empresa_id = p_empresa_id;
  if not found then v_activo := true; v_min := 30; end if;
  -- (la purga de operaciones viejas ya NO se hace acá: ver purgar_operaciones_pedido)

  -- ¿Esta operación ya existe? (reintento del mismo envío / confirmación)
  select * into v_op from public.pedido_operaciones where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
  if found then
    if v_op.huella <> p_huella or v_op.sucursal_id <> p_sucursal_id
       or v_op.id_telefono is distinct from v_tel or v_op.id_visitante is distinct from v_vis
       or v_op.id_dispositivo is distinct from p_dispositivo_id then
      return jsonb_build_object('estado', 'OPERACION_INVALIDA');   -- mismo id con otro contenido/identidad
    end if;
    if v_op.estado = 'COMPLETADA' then
      return jsonb_build_object('estado', 'EXISTENTE', 'pedido_id', v_op.pedido_id);
    elsif v_op.estado = 'EN_CURSO' then
      -- (revisión CTO 8/11) ¿El pedido de esta operación YA existe? (crear_ commiteó y completar_ falló o aún no corrió):
      -- se recupera AHORA, sin esperar los 90 s: se cierra el registro y se devuelve el pedido existente.
      select p.id into v_ped_id from public.pedidos p where p.empresa_id = p_empresa_id and p.operacion_id = p_operacion_id;
      if found then
        update public.pedido_operaciones set estado = 'COMPLETADA', pedido_id = v_ped_id, updated_at = now()
         where empresa_id = p_empresa_id and operacion_id = p_operacion_id and estado = 'EN_CURSO';
        return jsonb_build_object('estado', 'EXISTENTE', 'pedido_id', v_ped_id);
      end if;
      if v_op.updated_at < now() - interval '90 seconds' then
        update public.pedido_operaciones set updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
        return jsonb_build_object('estado', 'NUEVA');              -- abandonada: se retoma
      end if;
      return jsonb_build_object('estado', 'EN_CURSO');
    end if;
    -- ADVERTIDA: o confirma (válido solo porque el servidor ya la advirtió) o se reevalúa
    if p_confirmar then
      update public.pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
      return jsonb_build_object('estado', 'NUEVA', 'confirmada', true);
    end if;
  end if;

  -- ¿Hay un pedido igual y reciente de la misma persona? (solo con la prevención activa)
  if v_activo then
    select o.operacion_id, o.pedido_id, p.numero_pedido, p.estado as estado_pedido, o.created_at
      into v_dup
      from public.pedido_operaciones o
      left join public.pedidos p on p.id = o.pedido_id
     where o.empresa_id = p_empresa_id and o.sucursal_id = p_sucursal_id and o.huella = p_huella
       and o.operacion_id <> p_operacion_id
       and o.estado in ('EN_CURSO','COMPLETADA')
       and o.created_at >= now() - make_interval(mins => v_min)
       and (o.estado = 'EN_CURSO' or (p.id is not null and p.estado is distinct from 'CANCELLED'))
       and case
             when v_tel is not null and o.id_telefono is not null then o.id_telefono = v_tel
             when v_vis is not null and o.id_visitante is not null then o.id_visitante = v_vis
             when p_dispositivo_id is not null and o.id_dispositivo is not null
                  and v_tel is null and v_vis is null and o.id_telefono is null and o.id_visitante is null then o.id_dispositivo = p_dispositivo_id
             else false
           end
     order by o.created_at desc limit 1;
    if found then
      if v_op.operacion_id is null then
        insert into public.pedido_operaciones(empresa_id, operacion_id, sucursal_id, huella, id_telefono, id_visitante, id_dispositivo, estado)
        values (p_empresa_id, p_operacion_id, p_sucursal_id, p_huella, v_tel, v_vis, p_dispositivo_id, 'ADVERTIDA');
      end if;
      return jsonb_build_object('estado', 'DUPLICADO', 'ventana_minutos', v_min,
        'existente', jsonb_build_object('pedido_id', v_dup.pedido_id, 'numero_pedido', v_dup.numero_pedido, 'estado', v_dup.estado_pedido));
    end if;
  end if;

  -- Operación nueva (o ADVERTIDA que ya no tiene repetido vigente)
  if v_op.operacion_id is null then
    insert into public.pedido_operaciones(empresa_id, operacion_id, sucursal_id, huella, id_telefono, id_visitante, id_dispositivo, estado)
    values (p_empresa_id, p_operacion_id, p_sucursal_id, p_huella, v_tel, v_vis, p_dispositivo_id, 'EN_CURSO');
  else
    update public.pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
  end if;
  return jsonb_build_object('estado', 'NUEVA');
end; $function$;

revoke all on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) to service_role;
comment on function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) is 'coneos:pedidos-repetidos-8-11';
commit;
