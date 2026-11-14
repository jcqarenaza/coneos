-- Pedidos duplicados — corrección CTO 14/11: un pedido resuelto como DUPLICADO deja de ser candidato activo.
-- Cambia SOLO public.reclamar_operacion_pedido (10 parámetros): agrega UNA condición al selector de candidatos del modo bloqueo.
-- NO toca pedidos.estado, tablas, datos, devolución de stock/sabores, ventana de horas, MP ni seguimiento. Idempotente.
-- Requiere pedidos-duplicados-bloqueo.sql ya aplicado. Reversión: pedidos-duplicados-excluir-resueltos-REVERSION.sql
begin;

create or replace function public.reclamar_operacion_pedido(
  p_empresa_id uuid, p_sucursal_id uuid, p_operacion_id uuid, p_huella text,
  p_telefono text, p_visitante text, p_dispositivo_id uuid, p_confirmar boolean default false,
  p_alcance_bloqueo boolean default false, p_confirmar_otro boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to pg_catalog, pg_temp
as $function$
declare
  v_activo boolean := true; v_min integer := 30; v_bloq boolean := false; v_horas integer := 3; v_modo boolean := false;
  v_op record; v_dup record; v_tel text := nullif(regexp_replace(coalesce(p_telefono,''), '\D', '', 'g'), '');
  v_tel_n text := public.normalizar_telefono_pedido(p_telefono);
  v_vis text := nullif(p_visitante, ''); v_ped_id uuid; v_mismo boolean := false;
  v_cands uuid[] := array[]::uuid[]; v_snap jsonb := '[]'::jsonb; v_row record; v_hay boolean := false; v_ident boolean := false;
  v_activos constant text[] := array['PENDING_PAYMENT','PAID','PREPARING','READY'];
begin
  if p_empresa_id is null or p_sucursal_id is null or p_operacion_id is null or coalesce(p_huella,'') = '' then
    raise exception 'OPERACION_DATOS_INVALIDOS' using errcode = 'P0001';
  end if;

  select coalesce(prevenir_pedidos_repetidos, true), coalesce(pedidos_repetidos_minutos, 30),
         coalesce(bloquear_pedidos_duplicados, false), coalesce(pedido_activo_ventana_horas, 3)
    into v_activo, v_min, v_bloq, v_horas from public.empresa_config where empresa_id = p_empresa_id;
  if not found then v_activo := true; v_min := 30; v_bloq := false; v_horas := 3; end if;
  -- MODO BLOQUEO: alcance pedido por el servidor (delivery/take away online) + llave de la empresa + prevención activa
  v_modo := coalesce(p_alcance_bloqueo, false) and v_bloq and v_activo;

  -- Orden de locks FIJO: (1) teléfono normalizado, (2) contenido. Dos solicitudes del mismo teléfono (aunque con contenido distinto)
  -- se serializan en (1); las de igual contenido, en (2). Ninguna función toma (2) antes que (1).
  if v_modo and v_tel_n is not null then
    perform pg_advisory_xact_lock(hashtextextended('tel:' || p_empresa_id::text || ':' || p_sucursal_id::text || ':' || v_tel_n, 0));
  end if;
  -- Serializa TODO lo que tenga el mismo contenido en la misma sucursal: dos solicitudes
  -- simultáneas (misma operación o dos operaciones iguales) pasan de a una por acá.
  perform pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_sucursal_id::text || ':' || p_huella, 0));

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
    -- ADVERTIDA. FUERA del modo bloqueo: confirma como siempre. EN modo bloqueo la confirmación legacy NO vale nada:
    -- se re-evalúa abajo (el nivel 1 vuelve a bloquear; el nivel 2 solo acepta p_confirmar_otro).
    if p_confirmar and not v_modo then
      update public.pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
      return jsonb_build_object('estado', 'NUEVA', 'confirmada', true);
    end if;
  end if;

  if v_modo then
    -- CANDIDATOS (CTO 14/11, D1). Ya NO hay bloqueo duro: contenido idéntico o distinto, el cliente recibe el MISMO aviso y puede continuar con
    -- «Es otro pedido, continuar»; la protección pasa a Vista Caja (pedido_revisiones_duplicado + compuerta de preparación en el servidor).
    -- Candidato = pedido ACTIVO de la misma persona:
    --   · por TELÉFONO normalizado dentro de pedido_activo_ventana_horas (cualquier contenido), o
    --   · por la identidad existente (visitante / dispositivo, sin teléfono) con la MISMA huella dentro de pedidos_repetidos_minutos.
    -- Orden: el del mismo visitante, luego el de contenido idéntico, luego el más reciente. Una operación EN_CURSO sin pedido todavía (carrera)
    -- también es candidata (90 s): la relación se guarda por OPERACIÓN, que existe desde el reclamo, no por pedido.
    for v_row in
      select o.operacion_id, p.id as pedido_id, p.numero_pedido, p.estado as estado_pedido, o.id_visitante as vis_existente,
             (o.huella = p_huella) as misma_huella
        from public.pedido_operaciones o
        left join public.pedidos p on p.empresa_id = o.empresa_id and p.operacion_id = o.operacion_id
       where o.empresa_id = p_empresa_id and o.sucursal_id = p_sucursal_id
         and o.operacion_id <> p_operacion_id
         and o.estado in ('EN_CURSO','COMPLETADA')
         -- CTO 14/11 (corrección): un pedido que Luci ya resolvió como DUPLICADO conserva pedidos.estado (p. ej. PENDING_PAYMENT) pero NO es un pedido
         -- activo de la persona: no vuelve a ser candidato ni destino de «Ver mi pedido». LEGITIMO y PENDIENTE siguen siendo candidatos; sin revisión, igual que antes.
         and not exists (select 1 from public.pedido_revisiones_duplicado rd
                          where rd.empresa_id = o.empresa_id and rd.operacion_id = o.operacion_id and rd.estado = 'DUPLICADO')
         and ((p.id is not null and p.estado = any (v_activos))
              or (p.id is null and o.estado = 'EN_CURSO' and o.updated_at >= now() - interval '90 seconds'))
         and (
              (v_tel_n is not null and o.id_telefono is not null
                 and o.created_at >= now() - make_interval(hours => v_horas)
                 and public.normalizar_telefono_pedido(o.id_telefono) = v_tel_n)
           or (o.huella = p_huella and o.created_at >= now() - make_interval(mins => v_min)
                 and case
                       when v_tel is not null and o.id_telefono is not null
                         then (o.id_telefono = v_tel or public.normalizar_telefono_pedido(o.id_telefono) = v_tel_n)
                       when v_vis is not null and o.id_visitante is not null then o.id_visitante = v_vis
                       when p_dispositivo_id is not null and o.id_dispositivo is not null
                            and v_tel is null and v_vis is null and o.id_telefono is null and o.id_visitante is null then o.id_dispositivo = p_dispositivo_id
                       else false
                     end)
             )
       order by (v_vis is not null and o.id_visitante = v_vis) desc, (o.huella = p_huella) desc, o.created_at desc
    loop
      v_cands := v_cands || v_row.operacion_id;
      if not v_hay then v_dup := v_row; v_hay := true; end if;
      if v_row.misma_huella then v_ident := true; end if;
    end loop;

    if v_hay then
      v_mismo := v_vis is not null and v_dup.vis_existente is not distinct from v_vis;
      -- Excepción explícita ("Es otro pedido, continuar"): vale SOLO si el servidor YA advirtió esta misma operación (ADVERTIDA).
      if coalesce(p_confirmar_otro, false) and v_op.estado = 'ADVERTIDA' then
        update public.pedido_operaciones set estado = 'EN_CURSO', updated_at = now() where empresa_id = p_empresa_id and operacion_id = p_operacion_id;
        -- Relación pedido nuevo ↔ candidatos: se registra ACÁ, en la misma transacción y bajo los mismos locks (teléfono → contenido) que el reclamo,
        -- antes de que exista el pedido. El pedido se enlaza después por pedidos.operacion_id. Idempotente (reintentos de la misma operación).
        -- Foto de los candidatos (mínimo para poder compararlos aunque el candidato se elimine o su operación se purgue). Mismo orden que v_cands.
        begin   -- la foto es ACCESORIA: si fallara por cualquier motivo, NUNCA debe impedir crear el pedido
          select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_snap from (
            select array_position(v_cands, pc.operacion_id) as ord, jsonb_build_object(
              'operacion_id', pc.operacion_id, 'numero_pedido', pc.numero_pedido, 'created_at', pc.created_at, 'estado', pc.estado,
              'cliente', coalesce(nullif(pc.nombre_cliente, ''), pc.datos_delivery ->> 'nombre'),
              'items', coalesce((select jsonb_agg(jsonb_build_object('nombre', i.nombre_producto_snap, 'presentacion', i.nombre_presentacion_snap, 'cantidad', i.cantidad,
                         'opciones', coalesce((select jsonb_agg(o.nombre_snap order by o.id) from public.pedido_item_opciones o where o.pedido_item_id = i.id), '[]'::jsonb)) order by i.id)
                       from public.pedido_items i where i.pedido_id = pc.id), '[]'::jsonb)) as j
            from public.pedidos pc where pc.empresa_id = p_empresa_id and pc.operacion_id = any (v_cands)) x;
        exception when others then v_snap := '[]'::jsonb; end;
        insert into public.pedido_revisiones_duplicado (empresa_id, sucursal_id, operacion_id, candidatos, coincidencia, candidatos_snapshot)
        values (p_empresa_id, p_sucursal_id, p_operacion_id, v_cands, case when v_ident then 'IDENTICA' else 'DISTINTA' end, v_snap)
        on conflict (empresa_id, operacion_id) do nothing;
        return jsonb_build_object('estado', 'NUEVA', 'confirmada_otro', true);
      end if;
      if v_op.operacion_id is null then
        insert into public.pedido_operaciones(empresa_id, operacion_id, sucursal_id, huella, id_telefono, id_visitante, id_dispositivo, estado)
        values (p_empresa_id, p_operacion_id, p_sucursal_id, p_huella, v_tel, v_vis, p_dispositivo_id, 'ADVERTIDA');
      end if;
      -- PRIVACIDAD (CTO 14/11): pedido_id / numero_pedido / estado SOLO si el pedido es del mismo visitante.
      return jsonb_build_object('estado', 'PEDIDO_ACTIVO', 'ventana_horas', v_horas,
        'coincidencia', case when v_ident then 'IDENTICA' else 'DISTINTA' end,
        'existente', jsonb_build_object('mismo_visitante', v_mismo) ||
          case when v_mismo then jsonb_build_object('pedido_id', v_dup.pedido_id, 'numero_pedido', v_dup.numero_pedido, 'estado', v_dup.estado_pedido)
               else '{}'::jsonb end);
    end if;
  elsif v_activo then
    -- Comportamiento ANTERIOR, sin cambios (kiosco, caja, mesas, empresas con la llave apagada)
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

commit;
