CREATE OR REPLACE FUNCTION public._calcular_ajuste_stock(p_empresa_id uuid, p_sucursal_id uuid, p_lote_id uuid, p_motivo_tipo text, p_descripcion text, p_items jsonb, p_pct numeric DEFAULT 20, p_min_unid integer DEFAULT 5, p_abs_item integer DEFAULT 50, p_abs_lote integer DEFAULT 100, p_nuevas uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_n integer; v_d integer; v_mal boolean; v_validos integer; v_en_conteo integer; v_cont record;
  v_items jsonb; v_total integer; v_recortes integer; v_imp integer; v_txt text; v_req boolean; v_motivos jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'AJUSTE_SIN_ITEMS' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'AJUSTE_DEMASIADOS_ITEMS' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sucursales where id = p_sucursal_id and empresa_id = p_empresa_id) then
    raise exception 'SUCURSAL_INVALIDA' using errcode = 'P0001';
  end if;
  select * into v_cont from stock_conteos where id = p_lote_id;
  if not found then raise exception 'CONTEO_NO_ENCONTRADO' using errcode = 'P0001'; end if;
  if v_cont.empresa_id <> p_empresa_id or v_cont.sucursal_id <> p_sucursal_id then
    raise exception 'LOTE_DE_OTRO_ALCANCE' using errcode = 'P0001';
  end if;

  select count(*), count(distinct producto_id),
         coalesce(bool_or(producto_id is null or contado is null or contado < 0), false)
    into v_n, v_d, v_mal
    from jsonb_to_recordset(p_items) as x(producto_id uuid, contado integer);
  if v_mal then raise exception 'AJUSTE_ITEM_INVALIDO' using errcode = 'P0001'; end if;
  if v_n <> v_d then raise exception 'AJUSTE_PRODUCTO_REPETIDO' using errcode = 'P0001'; end if;

  select count(*) into v_validos
    from jsonb_to_recordset(p_items) as x(producto_id uuid, contado integer)
    join productos p on p.id = x.producto_id and p.empresa_id = p_empresa_id
     and p.controla_stock is true and p.activo is true and p.deleted_at is null;
  if v_validos <> v_n then raise exception 'PRODUCTO_INVALIDO' using errcode = 'P0001'; end if;

  select count(*) into v_en_conteo
    from jsonb_to_recordset(p_items) as x(producto_id uuid, contado integer)
    join stock_conteo_base b on b.conteo_id = p_lote_id and b.producto_id = x.producto_id;
  if v_en_conteo <> v_n then raise exception 'PRODUCTO_FUERA_DEL_CONTEO' using errcode = 'P0001'; end if;

  with x as (
    select s.producto_id, p.nombre, b.base, s.contado,
           coalesce(ps.cantidad, 0) as actual, (ps.id is null or s.producto_id = any(coalesce(p_nuevas, '{}'::uuid[]))) as fila_nueva,
           (s.contado - b.base) as diff_pedida,
           greatest(0, coalesce(ps.cantidad, 0) + (s.contado - b.base)) as final
      from jsonb_to_recordset(p_items) as s(producto_id uuid, contado integer)
      join productos p on p.id = s.producto_id
      join stock_conteo_base b on b.conteo_id = p_lote_id and b.producto_id = s.producto_id
      left join producto_stock ps on ps.producto_id = s.producto_id and ps.sucursal_id = p_sucursal_id
  ), y as (
    select x.*, (x.final - x.actual) as diff_aplicada,
           (x.actual + x.diff_pedida < 0) as recortado,
           (abs(x.diff_pedida) >= p_abs_item
            or (x.base > 0 and abs(x.diff_pedida) >= p_min_unid and abs(x.diff_pedida) * 100 >= p_pct * x.base)
            or (x.actual + x.diff_pedida < 0)) as importante
      from x
  )
  select jsonb_agg(jsonb_build_object(
           'producto_id', producto_id, 'nombre', nombre, 'base', base, 'contado', contado, 'actual', actual,
           'fila_nueva', fila_nueva, 'diff_pedida', diff_pedida, 'diff_aplicada', diff_aplicada, 'final', final,
           'recortado', recortado, 'importante', importante) order by producto_id),
         coalesce(sum(abs(diff_pedida)), 0)::integer,
         count(*) filter (where recortado)::integer,
         count(*) filter (where importante)::integer,
         -- La huella cubre TODO lo que el administrador vio: base, contado, diferencia pedida, stock ACTUAL,
         -- stock FINAL, diferencia aplicada y recorte. Si entra una venta/compra y cambia actual o final, cambia la huella.
         string_agg(producto_id::text || ':' || base || ':' || contado || ':' || diff_pedida || ':' || actual || ':' || final || ':' ||
                    diff_aplicada || ':' || recortado::text, '|' order by producto_id)
    into v_items, v_total, v_recortes, v_imp, v_txt
    from y;

  v_req := (v_imp > 0) or (v_total >= p_abs_lote);
  if v_recortes > 0 then v_motivos := v_motivos || '"recorte_a_cero"'::jsonb; end if;
  if v_imp - v_recortes > 0 then v_motivos := v_motivos || '"diferencia_grande"'::jsonb; end if;
  if v_total >= p_abs_lote then v_motivos := v_motivos || '"lote_grande"'::jsonb; end if;

  return jsonb_build_object(
    'lote_id', p_lote_id, 'items', v_items,
    'resumen', jsonb_build_object('items_n', v_n, 'total_abs', v_total, 'recortes_n', v_recortes, 'importantes_n', v_imp,
                                  'requiere_confirmacion', v_req, 'motivos_confirmacion', v_motivos),
    'huella', encode(sha256(convert_to(
        p_lote_id::text || '#' || p_empresa_id::text || '#' || p_sucursal_id::text || '#' || p_motivo_tipo || '#' ||
        btrim(coalesce(p_descripcion, '')) || '#' || coalesce(v_txt, ''), 'UTF8')), 'hex'));
end $function$;
