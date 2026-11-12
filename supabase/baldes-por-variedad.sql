-- ============================================================
-- BALDES: cada variedad pasa a ser una PRESENTACIÓN (con su foto), como en Bombón Suizo.
-- Balde 2 litros -> 8 presentaciones, Balde 3 litros -> 9, Balde 5 litros -> 6.
-- Las presentaciones nuevas NO permiten opciones (así entra "Stock por presentación").
-- Correr MANUAL en Supabase SQL Editor. Empresa: Cecchetto (lab de Marina).
-- Para otra empresa, cambiar v_empresa abajo.
--
-- Qué hace, por cada producto Balde 2/3/5 litros:
--   1. Por cada variedad activa del grupo "Variedades Balde NL" crea una presentación:
--      nombre = la variedad, precio = el de la presentación vieja, foto = la de la variedad.
--   2. La presentación vieja "Balde NL" queda desactivada y sin opciones (no se borra:
--      los pedidos viejos siguen apuntando a ella).
--   Se puede correr más de una vez: no duplica.
-- ============================================================
begin;

do $$
declare
  v_empresa uuid := 'cdd77401-6b81-474f-b96c-8faaca1476fd';
  r record;
  v_n int := 0;
begin
  for r in
    select pr.id as pres_vieja, pr.producto_id, pr.precio, o.nombre, o.imagen_url, o.orden
    from presentaciones pr
    join productos p on p.id = pr.producto_id
    join presentacion_grupos pg on pg.presentacion_id = pr.id
    join grupos_opciones g on g.id = pg.grupo_id
    join opciones o on o.grupo_id = g.id and o.activo and o.deleted_at is null
    where p.empresa_id = v_empresa and p.deleted_at is null
      and p.nombre in ('Balde 2 litros', 'Balde 3 litros', 'Balde 5 litros')
      and g.nombre in ('Variedades Balde 2L', 'Variedades Balde 3L', 'Variedades Balde 5L')
      and pr.nombre in ('Balde 2L', 'Balde 3L', 'Balde 5L')
    order by p.nombre, o.orden, o.nombre
  loop
    if not exists (select 1 from presentaciones x where x.producto_id = r.producto_id and x.nombre = r.nombre) then
      insert into presentaciones (producto_id, empresa_id, nombre, precio, permite_opciones, opciones_min, opciones_max, orden, activo, imagen_url)
      values (r.producto_id, v_empresa, r.nombre, r.precio, false, 0, 0, r.orden, true, r.imagen_url);
      v_n := v_n + 1;
    end if;
  end loop;

  -- La presentación vieja (la que tenía las variedades como opciones) se retira, sin borrarla.
  update presentaciones
     set activo = false, permite_opciones = false, opciones_min = 0, opciones_max = 0
   where empresa_id = v_empresa
     and nombre in ('Balde 2L', 'Balde 3L', 'Balde 5L')
     and producto_id in (select id from productos where empresa_id = v_empresa and nombre in ('Balde 2 litros', 'Balde 3 litros', 'Balde 5 litros'));

  raise notice 'Presentaciones nuevas creadas: %', v_n;
end $$;

-- Control: cada balde con sus variedades y precio
select p.nombre as producto, count(*) as variedades, min(pr.precio) as precio,
       count(*) filter (where pr.imagen_url is not null) as con_foto,
       bool_or(pr.permite_opciones) as alguna_permite_opciones
from productos p
join presentaciones pr on pr.producto_id = p.id and pr.activo
where p.empresa_id = 'cdd77401-6b81-474f-b96c-8faaca1476fd'
  and p.nombre in ('Balde 2 litros', 'Balde 3 litros', 'Balde 5 litros')
group by p.nombre order by p.nombre;

commit;

-- ROLLBACK (si hay que volver atrás; correr aparte):
-- delete from presentaciones where empresa_id = 'cdd77401-6b81-474f-b96c-8faaca1476fd' and permite_opciones = false and activo
--   and producto_id in (select id from productos where nombre in ('Balde 2 litros','Balde 3 litros','Balde 5 litros'))
--   and nombre not in ('Balde 2L','Balde 3L','Balde 5L')
--   and not exists (select 1 from pedido_items i where i.presentacion_id = presentaciones.id);
-- update presentaciones set activo = true, permite_opciones = true, opciones_min = 1, opciones_max = 1
--  where empresa_id = 'cdd77401-6b81-474f-b96c-8faaca1476fd' and nombre in ('Balde 2L','Balde 3L','Balde 5L');
