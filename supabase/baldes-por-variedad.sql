-- ============================================================
-- BALDES: un producto por variedad (con su foto) y 3 presentaciones
-- (Balde 2L / 3L / 5L), igual que Bombón Suizo (Porción / Caja x 6 / Caja x 15).
-- Correr MANUAL en Supabase SQL Editor. Empresa: Cecchetto (lab de Marina).
-- Para otra empresa, cambiar v_empresa abajo.
--
-- Qué hace:
--   1. Toma las variedades de los 3 grupos "Variedades Balde 2L/3L/5L".
--   2. Une las que son la misma mezcla de sabores aunque cambie el orden o las
--      mayúsculas (ej. "Granizado, dulce de leche y vainilla" = "Granizado, Vainilla y Dulce de Leche").
--   3. Crea un PRODUCTO por variedad (categoría Baldes, con la foto) y le crea
--      las presentaciones Balde 2L / 3L / 5L SOLO en los tamaños donde esa variedad existía,
--      con el precio de cada tamaño.
--   4. Desactiva (no borra) los 3 productos viejos "Balde 2/3/5 litros", así el
--      historial de pedidos queda intacto.
--   Se puede correr más de una vez: no duplica nada.
-- Deshacer: ver bloque ROLLBACK al final.
-- ============================================================
begin;

do $$
declare
  v_empresa uuid := 'cdd77401-6b81-474f-b96c-8faaca1476fd';
  v_cat uuid;
  r record;
  v_prod uuid;
  v_n int := 0;
begin
  select id into v_cat from categorias where empresa_id = v_empresa and nombre ilike 'baldes' and deleted_at is null limit 1;
  if v_cat is null then raise exception 'No existe la categoría Baldes en esta empresa'; end if;

  create temp table _bv on commit drop as
  select
    o.id as opcion_id, o.nombre, o.imagen_url, o.orden as ord,
    case g.nombre when 'Variedades Balde 2L' then 2 when 'Variedades Balde 3L' then 3 when 'Variedades Balde 5L' then 5 end as litros,
    pr.id as pres_vieja, pr.precio,
    (select string_agg(trim(k.w), ',' order by trim(k.w))
       from unnest(regexp_split_to_array(lower(regexp_replace(o.nombre, '\s+y\s+', ',', 'gi')), ',')) as k(w)
      where trim(k.w) <> '') as clave
  from opciones o
  join grupos_opciones g on g.id = o.grupo_id
  join presentacion_grupos pg on pg.grupo_id = g.id
  join presentaciones pr on pr.id = pg.presentacion_id
  where g.empresa_id = v_empresa and o.deleted_at is null and o.activo
    and g.nombre in ('Variedades Balde 2L', 'Variedades Balde 3L', 'Variedades Balde 5L');

  for r in
    select clave,
           (array_agg(nombre order by (imagen_url is not null) desc, litros desc))[1] as nombre,
           (array_agg(imagen_url order by (imagen_url is not null) desc, litros desc))[1] as foto,
           min(ord) as orden
    from _bv group by clave order by min(ord), clave
  loop
    select id into v_prod from productos
     where empresa_id = v_empresa and categoria_id = v_cat and deleted_at is null
       and lower(nombre) = lower(upper(left(r.nombre, 1)) || substr(r.nombre, 2));
    if v_prod is null then
      insert into productos (empresa_id, categoria_id, nombre, imagen_url, orden, activo)
      values (v_empresa, v_cat, upper(left(r.nombre, 1)) || substr(r.nombre, 2), r.foto, 100 + r.orden, true)
      returning id into v_prod;
      v_n := v_n + 1;
    end if;

    insert into presentaciones (producto_id, empresa_id, nombre, precio, permite_opciones, opciones_min, opciones_max, orden, activo)
    select v_prod, v_empresa, 'Balde ' || b.litros || 'L', max(b.precio), false, 0, 0, b.litros, true
      from _bv b
     where b.clave = r.clave
       and not exists (select 1 from presentaciones x where x.producto_id = v_prod and x.nombre = 'Balde ' || b.litros || 'L')
     group by b.litros;
  end loop;

  -- Los 3 productos viejos (una presentación con variedades como opciones) se desactivan, no se borran.
  update presentaciones set activo = false where id in (select distinct pres_vieja from _bv);
  update productos set activo = false
   where id in (select producto_id from presentaciones where id in (select distinct pres_vieja from _bv));

  raise notice 'Productos nuevos creados: %', v_n;
end $$;

-- Control: cada variedad con sus tamaños y precios
select p.nombre as variedad, string_agg(pr.nombre || ' $' || pr.precio::int, ' · ' order by pr.orden) as presentaciones, p.imagen_url is not null as con_foto
from productos p
join categorias c on c.id = p.categoria_id and c.nombre ilike 'baldes'
join presentaciones pr on pr.producto_id = p.id and pr.activo
where p.empresa_id = 'cdd77401-6b81-474f-b96c-8faaca1476fd' and p.activo and p.deleted_at is null
group by p.id, p.nombre, p.imagen_url order by p.orden;

commit;

-- ROLLBACK (si hay que volver atrás; correr aparte):
-- update productos set activo = true where empresa_id = 'cdd77401-6b81-474f-b96c-8faaca1476fd' and nombre in ('Balde 2 litros','Balde 3 litros','Balde 5 litros');
-- update presentaciones set activo = true where empresa_id = 'cdd77401-6b81-474f-b96c-8faaca1476fd' and nombre in ('Balde 2L','Balde 3L','Balde 5L') and producto_id in (select id from productos where nombre in ('Balde 2 litros','Balde 3 litros','Balde 5 litros'));
-- update productos set activo = false, deleted_at = now() where empresa_id = 'cdd77401-6b81-474f-b96c-8faaca1476fd' and categoria_id = (select id from categorias where empresa_id='cdd77401-6b81-474f-b96c-8faaca1476fd' and nombre ilike 'baldes' limit 1) and codigo is null and orden >= 100;
