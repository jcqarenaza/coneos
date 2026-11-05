#!/usr/bin/env python3
"""Devolución transaccional: devolver_stock_pedido vs flujo actual. Postgres LOCAL aislado."""
import os, json, uuid, threading, time
import psycopg2, psycopg2.extras
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__)); SUP = os.path.abspath(os.path.join(HERE, '..'))
CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db, ac=True):
    c = psycopg2.connect(dbname=db, **CONN); c.autocommit = ac; return c
R = []
def check(n, ok, d=''): R.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (f'  [{d}]' if d else ''), flush=True)
def build(name, diferido=True):
    a = connect('postgres'); a.cursor().execute(f'drop database if exists {name} with (force)'); a.cursor().execute(f'create database {name}'); a.close()
    c = connect(name).cursor()
    for f in ('00-schema-reducido.sql', 'stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql'):
        c.execute(open(os.path.join(HERE, f), encoding='utf-8').read())
    c.execute(open(os.path.join(SUP, 'devolver-stock-pedido.sql'), encoding='utf-8').read())
    if diferido: c.execute(open(os.path.join(HERE, 'stock-bump-diferido.sql'), encoding='utf-8').read())
    c.execute("do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if; if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$")
    if os.environ.get('COMB_A'): c.execute(open(os.path.join(HERE, 'parteA.sql'), encoding='utf-8').read())
    return name
PREC = {'p1': 1000, 'x8': 7000, 'lata': 500}
def world(db, stock_alf=100, stock_beb=100, f8=8):
    q = connect(db).cursor(); w = {}
    def one(sql, *a): q.execute(sql, a); return q.fetchone()[0]
    w['emp'] = one("insert into empresas default values returning id"); w['suc'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    q.execute("insert into catalogo_version(sucursal_id, empresa_id) values(%s,%s)", (w['suc'], w['emp']))
    w['alf'] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Alfajor',true) returning id", w['emp'])
    w['beb'] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Bebida',true) returning id", w['emp'])
    w['x8'] = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Caja x8',7000,%s) returning id", w['emp'], w['alf'], f8)
    w['p1'] = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Porción',1000,1) returning id", w['emp'], w['alf'])
    w['lata'] = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Lata',500,1) returning id", w['emp'], w['beb'])
    for k, s in (('alf', stock_alf), ('beb', stock_beb)):
        q.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,%s)", (w['emp'], w[k], w['suc'], s))
    w['db'] = db; return w
def it(w, k, n=1): return {'presentacion_id': str(w[k]), 'cantidad': n, 'precio_snap': PREC[k], 'nombre_producto_snap': k, 'nombre_presentacion_snap': k, 'opciones': []}
def venta(w, items, conn=None):
    cn = conn or connect(w['db']); cu = cn.cursor()
    cu.execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'kiosk', p_tipo_pedido := 'local', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PENDING_PAYMENT', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := false)", (w['emp'], w['suc'], json.dumps(items)))
    return cu.fetchone()[0]
def pid(r): return r['pedido_id'] if isinstance(r, dict) and 'pedido_id' in r else (r.get('id') if isinstance(r, dict) else r)
def stk(w, k):
    cu = connect(w['db']).cursor(); cu.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (w[k], w['suc'])); return cu.fetchone()[0]
def flag(w, p):
    cu = connect(w['db']).cursor(); cu.execute("select stock_descontado from pedidos where id=%s", (p,)); return cu.fetchone()[0]
def devs(w, p=None):
    cu = connect(w['db']).cursor(); cu.execute("select count(*), coalesce(sum(delta),0) from stock_movimientos where empresa_id=%s and motivo='devolucion'" + (" and pedido_id=%s" if p else ""), (w['emp'],) + ((p,) if p else ())); return cu.fetchone()
def devolver(w, p, emp=None, conn=None):
    cn = conn or connect(w['db']); cu = cn.cursor()
    cu.execute("select devolver_stock_pedido(%s,%s)", (emp or w['emp'], p)); return cu.fetchone()[0]
def err(fn):
    try: fn(); return None
    except psycopg2.Error as e: return (e.pgerror or '').split('\n')[0]

db = build('dev_main'); 
# 1. x8 y porción: vuelven 8 + 3 = 11
w = world(db, 100, 100); r = venta(w, [it(w, 'x8', 1), it(w, 'p1', 3), it(w, 'lata', 2)]); p = pid(r)
a0 = (stk(w, 'alf'), stk(w, 'beb')); out = devolver(w, p)
check('1. Devolución: caja x8 + porción x3 + lata x2 vuelven 11 y 2, flag false, 2 movimientos', a0 == (89, 98) and (stk(w, 'alf'), stk(w, 'beb')) == (100, 100) and flag(w, p) is False and devs(w, p)[0] == 2 and out['devuelto'] is True, f'{a0} {out}')
# 2. repetida
out2 = devolver(w, p); check('2. Devolución repetida: no-op (devuelto=false), sin movimientos nuevos, stock igual', out2['devuelto'] is False and devs(w, p)[0] == 2 and (stk(w, 'alf'), stk(w, 'beb')) == (100, 100), str(out2))
# 3. test histórico
w = world(db, 100, 100); p = pid(venta(w, [it(w, 'x8', 1)]))
connect(db).cursor().execute("update presentaciones set factor_stock=10 where id=%s", (w['x8'],))
devolver(w, p); check('3. Test histórico: vender con 8, cambiar a 10, devolver → vuelven 8', stk(w, 'alf') == 100 and devs(w, p)[1] == 8, f"stock={stk(w,'alf')} delta={devs(w,p)}")
# 4. snapshot NULL
w = world(db, 50, 50); c = connect(db).cursor()
c.execute("insert into pedidos(empresa_id,sucursal_id,numero_pedido,fecha_pedido,estado,stock_descontado) values(%s,%s,1,current_date,'PENDING_PAYMENT',true) returning id", (w['emp'], w['suc'])); p = c.fetchone()[0]
c.execute("insert into pedido_items(pedido_id,presentacion_id,cantidad,factor_stock_snap) values(%s,%s,4,null)", (p, w['x8']))   # factor vigente 8, snapshot NULL → debe usar 1
devolver(w, p); check('4. Pedido anterior a V2 (snapshot NULL): 4 unidades devuelven 4 (no 32)', stk(w, 'alf') == 54 and devs(w, p)[1] == 4, f"stock={stk(w,'alf')}")
# 5. sin descuento pendiente / pedido de otra empresa / inexistente
w = world(db, 10, 10); c = connect(db).cursor()
c.execute("insert into pedidos(empresa_id,sucursal_id,numero_pedido,fecha_pedido,estado,stock_descontado) values(%s,%s,1,current_date,'PENDING_PAYMENT',false) returning id", (w['emp'], w['suc'])); p = c.fetchone()[0]
c.execute("insert into pedido_items(pedido_id,presentacion_id,cantidad,factor_stock_snap) values(%s,%s,3,1)", (p, w['p1']))
check('5a. Pedido con stock_descontado=false: no devuelve nada', devolver(w, p)['devuelto'] is False and stk(w, 'alf') == 10)
w2 = world(db, 10, 10); p2 = pid(venta(w2, [it(w2, 'p1', 2)]))
check('5b. Empresa equivocada → PEDIDO_NO_ENCONTRADO, nada se toca', 'PEDIDO_NO_ENCONTRADO' in (err(lambda: devolver(w2, p2, emp=w['emp'])) or '') and flag(w2, p2) is True and stk(w2, 'alf') == 8)
check('5c. Pedido inexistente → PEDIDO_NO_ENCONTRADO', 'PEDIDO_NO_ENCONTRADO' in (err(lambda: devolver(w2, uuid.uuid4())) or ''))
# 6. falla intermedia: trigger de prueba que rompe el movimiento de la Bebida (2º producto por producto_id)
def falla_intermedia(w, items_prod):
    lo, hi = sorted([w['alf'], w['beb']], key=str)
    c = connect(db).cursor()
    c.execute("create or replace function _boom() returns trigger language plpgsql as $$ begin if new.motivo='devolucion' and new.producto_id=%s::uuid then raise exception 'FALLA_SIMULADA'; end if; return new; end $$" % ("'" + str(hi) + "'"))
    c.execute("drop trigger if exists boom on stock_movimientos"); c.execute("create trigger boom before insert on stock_movimientos for each row execute function _boom()")
    return lo, hi
def sin_falla():
    connect(db).cursor().execute("drop trigger if exists boom on stock_movimientos")
w = world(db, 100, 100); p = pid(venta(w, [it(w, 'x8', 1), it(w, 'lata', 2)])); lo, hi = falla_intermedia(w, None)
estado0 = (stk(w, 'alf'), stk(w, 'beb'))
e = err(lambda: devolver(w, p))
check('6a. RPC con falla en el 2º producto: ERROR, rollback total (flag true, stock y libro sin cambios)', e and 'FALLA_SIMULADA' in e and flag(w, p) is True and (stk(w, 'alf'), stk(w, 'beb')) == estado0 and devs(w, p)[0] == 0, f'{e} {estado0}')
sin_falla(); out = devolver(w, p)
check('6b. Reintento tras la falla: devuelve todo, una sola vez', out['devuelto'] is True and (stk(w, 'alf'), stk(w, 'beb')) == (100, 100) and devs(w, p)[0] == 2 and flag(w, p) is False, str(out))
# 6c. CONTRASTE: flujo ACTUAL de la ruta (flip y luego ajustar_stock por producto, cada uno por su lado)
w = world(db, 100, 100); p = pid(venta(w, [it(w, 'x8', 1), it(w, 'lata', 2)])); lo, hi = falla_intermedia(w, None)
cn = connect(db); cu = cn.cursor()
cu.execute("update pedidos set stock_descontado=false where id=%s and stock_descontado=true returning id", (p,)); assert cu.fetchone()
cu.execute("select pr.id, sum(i.cantidad*coalesce(i.factor_stock_snap,1)) from pedido_items i join presentaciones x on x.id=i.presentacion_id join productos pr on pr.id=x.producto_id where i.pedido_id=%s group by pr.id order by pr.id", (p,))
errores = []
for prod, q in cu.fetchall():
    try: connect(db).cursor().execute("select ajustar_stock(%s,%s,%s,%s,'delta','devolucion',%s,'x')", (w['emp'], w['suc'], prod, int(q), p))
    except psycopg2.Error as ex: errores.append((ex.pgerror or '').split('\n')[0])
sin_falla()
parcial = (stk(w, 'alf'), stk(w, 'beb'))
r2 = connect(db).cursor(); r2.execute("update pedidos set stock_descontado=false where id=%s and stock_descontado=true returning id", (p,)); reint = r2.fetchone()
check('6c. CONTRASTE flujo actual: queda flag=false con la devolución A MEDIAS y el reintento no puede completarla (defecto confirmado)', flag(w, p) is False and parcial != (100, 100) and reint is None, f'stock tras falla={parcial} (esperado 100,100) errores={errores} reintento_flip={reint}')
# 7. concurrencia: 8 hilos devuelven el mismo pedido
w = world(db, 100, 100); p = pid(venta(w, [it(w, 'x8', 2), it(w, 'lata', 1)])); res = []
def h():
    try: res.append(devolver(w, p)['devuelto'])
    except psycopg2.Error as e: res.append(e.pgcode)
ts = [threading.Thread(target=h) for _ in range(8)]; [t.start() for t in ts]; [t.join() for t in ts]
check('7. 8 devoluciones simultáneas del mismo pedido: exactamente 1 devuelve, 2 movimientos, stock exacto', res.count(True) == 1 and res.count(False) == 7 and devs(w, p)[0] == 2 and (stk(w, 'alf'), stk(w, 'beb')) == (100, 100), str(res))
# 8. devolución contra ventas simultáneas cruzadas (con y sin bump diferido)
def estres(dbn, etiqueta):
    w = world(dbn, 5000, 5000); peds = [pid(venta(w, [it(w, 'p1', 1), it(w, 'lata', 1)])) for _ in range(60)]
    errs = []; lock = threading.Lock()
    def dev(pp):
        try: devolver(w, pp)
        except psycopg2.Error as e:
            with lock: errs.append(e.pgcode)
    def ven(i):
        try: venta(w, [it(w, 'lata', 1)] if i % 2 else [it(w, 'p1', 1), it(w, 'lata', 1)], conn=connect(dbn))
        except psycopg2.Error as e:
            with lock: errs.append(e.pgcode)
    ts = [threading.Thread(target=dev, args=(pp,)) for pp in peds] + [threading.Thread(target=ven, args=(i,)) for i in range(60)]
    import random; random.Random(3).shuffle(ts); [t.start() for t in ts]; [t.join() for t in ts]
    cu = connect(dbn).cursor()
    cu.execute("select p.nombre, ps.cantidad, 5000 + coalesce((select sum(delta) from stock_movimientos m where m.producto_id=ps.producto_id and m.sucursal_id=ps.sucursal_id),0) from producto_stock ps join productos p on p.id=ps.producto_id where ps.sucursal_id=%s", (w['suc'],))
    conc = cu.fetchall(); print(f'   ({etiqueta}) errores={errs.count("40P01")} deadlocks, otros={[e for e in errs if e!="40P01"]}, libro={conc}', flush=True)
    return errs.count('40P01'), all(a == b for _, a, b in conc)
d1, l1 = estres(db, 'con bump diferido')
check('8a. Devoluciones y ventas cruzadas simultáneas (con bump diferido): 0 deadlocks y el libro cierra', d1 == 0 and l1)
db2 = build('dev_nodef', diferido=False); d2, l2 = estres(db2, 'SIN bump diferido (informativo)')
check('8b. (informativo) sin el bump diferido: libro cierra aunque haya deadlocks', l2, f'deadlocks={d2}')
# 9. permisos
c = connect(db).cursor(); c.execute("select has_function_privilege('anon','devolver_stock_pedido(uuid,uuid)','execute'), has_function_privilege('service_role','devolver_stock_pedido(uuid,uuid)','execute'), has_function_privilege('public','devolver_stock_pedido(uuid,uuid)','execute')")
pa, ps_, pp = c.fetchone(); check('9. Permisos: service_role sí; anon y PUBLIC no', ps_ and not pa and not pp, f'anon={pa} service_role={ps_} public={pp}')
# 10. REVERSIÓN
connect(db).cursor().execute(open(os.path.join(SUP, 'devolver-stock-pedido-REVERSION.sql'), encoding='utf-8').read())
c = connect(db).cursor(); c.execute("select count(*) from pg_proc where proname='devolver_stock_pedido'"); check('10. Reversión elimina la función y no toca datos', c.fetchone()[0] == 0)
print(f'\n{sum(R)}/{len(R)} PASS')
