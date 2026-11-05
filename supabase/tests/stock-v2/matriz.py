#!/usr/bin/env python3
"""Matriz de aceptación — Stock V2 factor (GO CTO 4/11/2026).
Corre contra un Postgres LOCAL aislado (socket unix, sin red). Nunca contra Supabase.
Uso: matriz.py base|v2     base = función viva actual (control: debe FALLAR lo de V2)
                           v2   = migración + rpc-crear-pedido-stock-v2-factor.sql
"""
import sys, json, uuid, threading, time, os
import psycopg2, psycopg2.extras, psycopg2.errors
psycopg2.extras.register_uuid()

MODE = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
SUP = os.path.join(HERE, '..', '..')   # carpeta supabase/
DB = 'v2test_' + MODE
CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')

def connect(db=DB, autocommit=True):
    c = psycopg2.connect(dbname=db, **CONN); c.autocommit = autocommit; return c

# ── base nueva ──
admin = connect('postgres'); cur = admin.cursor()
cur.execute(f'drop database if exists {DB} with (force)'); cur.execute(f'create database {DB}'); admin.close()
db = connect(); c = db.cursor()
c.execute(open(os.path.join(HERE, '00-schema-reducido.sql'), encoding='utf-8').read())
if MODE == 'v2':
    c.execute(open(os.path.join(SUP, 'stock-v2-factor-migracion.sql'), encoding='utf-8').read())
    c.execute(open(os.path.join(SUP, 'rpc-crear-pedido-stock-v2-factor.sql'), encoding='utf-8').read())
else:
    c.execute(open(os.path.join(SUP, 'versionado', 'crear_pedido_stock.vivo-2026-11-04.sql'), encoding='utf-8').read())

RESULTS = []
def check(name, ok, detail=''):
    RESULTS.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''), flush=True)

# ── mundo de datos fresco por prueba ──
def world(stock_alf=100, stock_beb=50, factor_x8=8, factor_x20=20):
    w = {}
    q = db.cursor()
    def one(sql, *a):
        q.execute(sql, a); return q.fetchone()[0]
    w['emp'] = one("insert into empresas default values returning id")
    w['suc'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    w['suc2'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    for s in (w['suc'], w['suc2']):
        q.execute("insert into catalogo_version(sucursal_id, empresa_id) values(%s,%s)", (s, w['emp']))
    w['alf'] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Alfajor',true) returning id", w['emp'])
    w['beb'] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Bebida',true) returning id", w['emp'])
    w['sin'] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Sin control',false) returning id", w['emp'])
    def pres(prod, nom, precio, f):
        return one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,%s,%s,%s) returning id", w['emp'], prod, nom, precio, f)
    w['p1'] = pres(w['alf'], 'Porción', 1000, 1)
    w['x8'] = pres(w['alf'], 'Caja x8', 7000, factor_x8)
    w['x20'] = pres(w['alf'], 'Caja x20', 15000, factor_x20)
    w['lata'] = pres(w['beb'], 'Lata', 500, 1)
    w['sinp'] = pres(w['sin'], 'Suelto', 300, 1)
    if stock_alf is not None:
        q.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,%s)", (w['emp'], w['alf'], w['suc'], stock_alf))
    if stock_beb is not None:
        q.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,%s)", (w['emp'], w['beb'], w['suc'], stock_beb))
    w['stock0'] = {w['alf']: stock_alf or 0, w['beb']: stock_beb or 0}
    # promo combo: Caja x8 + Lata = 7500
    w['promo'] = one("insert into promociones(empresa_id,nombre,precio) values(%s,'Combo caja+lata',7500) returning id", w['emp'])
    s1 = one("insert into promo_slots(promo_id,cantidad) values(%s,1) returning id", w['promo'])
    s2 = one("insert into promo_slots(promo_id,cantidad) values(%s,1) returning id", w['promo'])
    q.execute("insert into promo_slot_presentaciones(slot_id,presentacion_id) values(%s,%s),(%s,%s)", (s1, w['x8'], s2, w['lata']))
    w['slot1'], w['slot2'] = s1, s2
    return w

PRECIOS = {'p1': 1000, 'x8': 7000, 'x20': 15000, 'lata': 500, 'sinp': 300}
def item(w, key, qty=1, **extra):
    d = {'presentacion_id': str(w[key]), 'cantidad': qty, 'precio_snap': PRECIOS[key],
         'nombre_producto_snap': key, 'nombre_presentacion_snap': key, 'opciones': []}
    d.update(extra); return d

def sale(w, items, conn=None, mesa=None, suc=None):
    cu = (conn or db).cursor()
    cu.execute("""select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid,
      p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'kiosk', p_tipo_pedido := 'local', p_costo_envio := 0,
      p_datos_delivery := null::jsonb, p_estado := 'PAID', p_codigo_retiro := 'A1',
      p_mesa_cuenta_id := %s::uuid, p_numero_mesa := %s::int, p_pagado := %s::boolean)""",
      (w['emp'], suc or w['suc'], json.dumps(items), str(uuid.uuid4()) if mesa else None, mesa, False if mesa else True))
    return cu.fetchone()[0]

def stock(w, prod, suc=None):
    cu = db.cursor(); cu.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (w[prod], suc or w['suc']))
    r = cu.fetchone(); return r[0] if r else None

def movs(w, prod=None):
    cu = db.cursor()
    cu.execute("select motivo, delta, detalle from stock_movimientos where empresa_id=%s " + ("and producto_id=%s " if prod else "") + "order by created_at, id", (w['emp'],) + ((w[prod],) if prod else ()))
    return cu.fetchall()

def snaps(pid):
    cu = db.cursor(); cu.execute("select nombre_presentacion_snap, cantidad, factor_stock_snap from pedido_items where pedido_id=%s order by nombre_presentacion_snap", (pid,)); return cu.fetchall()

def raises(fn, needle):
    try:
        fn(); return False, 'no lanzó'
    except psycopg2.Error as e:
        msg = (e.pgerror or str(e)); return needle in msg, msg.splitlines()[0]

def ledger_ok(w):
    """libro cerrado: stock inicial + Σ movimientos == stock actual, por producto."""
    bad = []
    for prod in ('alf', 'beb'):
        cu = db.cursor(); cu.execute("select coalesce(sum(delta),0) from stock_movimientos where producto_id=%s and sucursal_id=%s", (w[prod], w['suc']))
        s = cu.fetchone()[0]; act = stock(w, prod)
        if act is None: continue
        if float(w['stock0'][w[prod]]) + float(s) != float(act): bad.append((prod, w['stock0'][w[prod]], s, act))
    return not bad, bad

# ── mismo flujo que /api/pedidos/eliminar (flip atómico → devolución por snapshot → ajustar_stock) ──
def eliminar(w, pedido_id, usar_factor_vigente=False):
    cu = db.cursor()
    cu.execute("update pedidos set stock_descontado=false where id=%s and stock_descontado=true returning id", (pedido_id,))
    if not cu.fetchall(): return 'sin_devolucion'
    cu.execute("""select i.cantidad, i.factor_stock_snap, pr.factor_stock, pr.producto_id
                    from pedido_items i join presentaciones pr on pr.id=i.presentacion_id
                    join productos p on p.id=pr.producto_id and p.controla_stock
                   where i.pedido_id=%s and i.presentacion_id is not null""", (pedido_id,))
    por = {}
    for cant, snap, vivo, prod in cu.fetchall():
        f = vivo if usar_factor_vigente else (1 if snap is None else snap)
        por[prod] = por.get(prod, 0) + int(cant) * int(f)
    for prod, qn in por.items():
        cu.execute("select ajustar_stock(%s,%s,%s,%s,'delta','devolucion',%s,'Devolución por eliminación')", (w['emp'], w['suc'], prod, qn, pedido_id))
    cu.execute("delete from pedido_items where pedido_id=%s", (pedido_id,)); cu.execute("delete from pedidos where id=%s", (pedido_id,))
    return 'devuelto'

V2 = MODE == 'v2'
print(f'=== MATRIZ modo={MODE} — Postgres local aislado ({DB}) ===', flush=True)

# 1. Presentación x8 y porción x1
w = world(); r = sale(w, [item(w, 'x8', 2)]); r2 = sale(w, [item(w, 'p1', 3)])
check('1. Caja x8 ×2 descuenta 16 y porción ×3 descuenta 3 (stock 100→81)', stock(w, 'alf') == 81, f'stock={stock(w,"alf")}')
sn = snaps(r['id']); check('1b. snapshot del factor grabado (x8 → 8)', [float(x[2]) if x[2] is not None else None for x in sn] == [8.0], f'{sn}')

# 2. Pedido mixto
w = world(); r = sale(w, [item(w, 'p1', 2), item(w, 'x8', 1), item(w, 'lata', 3)])
m = movs(w)
check('2. Mixto porción×2 + caja x8 + lata×3: Alfajor −10 y Bebida −3, un movimiento por producto',
      stock(w, 'alf') == 90 and stock(w, 'beb') == 47 and len(m) == 2 and sorted(float(x[1]) for x in m) == [-10.0, -3.0], f'alf={stock(w,"alf")} beb={stock(w,"beb")} movs={[(x[0],float(x[1])) for x in m]}')
check('2b. snapshots del mixto: lata 1, porción 1, caja x8 8', sorted(str(x[2]) for x in snaps(r['id'])) == ['1', '1', '8'], str(snaps(r['id'])))

# 3. Caja x20 sin stock suficiente (15)
w = world(stock_alf=15); ok, msg = raises(lambda: sale(w, [item(w, 'x20', 1)]), 'SIN_STOCK')
cu = db.cursor(); cu.execute("select count(*) from pedidos where empresa_id=%s", (w['emp'],)); npe = cu.fetchone()[0]
st_tras = stock(w, 'alf'); nm = len(movs(w)); r = sale(w, [item(w, 'p1', 1)])
check('3. Caja x20 con stock 15 → SIN_STOCK, sin pedido, sin movimiento, stock intacto y no consume número', ok and npe == 0 and st_tras == 15 and nm == 0 and r['numero_pedido'] == 1, f'{msg} | pedidos={npe} stock={st_tras} movs={nm} numero_siguiente={r["numero_pedido"]}')

# 4. Test histórico del CTO: vender con factor 8, cambiar a 10, eliminar → vuelven 8
w = world(); r = sale(w, [item(w, 'x8', 1)]); desc = 100 - stock(w, 'alf')
db.cursor().execute("update presentaciones set factor_stock=10 where id=%s", (w['x8'],))
res = eliminar(w, r['id']); vuelto = stock(w, 'alf') - (100 - desc)
check('4. Histórico: vender con factor 8, cambiarlo a 10, eliminar → vuelven 8 (por snapshot)', desc == 8 and stock(w, 'alf') == 100, f'descontó={desc} stock_final={stock(w,"alf")}')
if V2:
    w = world(); r = sale(w, [item(w, 'x8', 1)]); db.cursor().execute("update presentaciones set factor_stock=10 where id=%s", (w['x8'],))
    eliminar(w, r['id'], usar_factor_vigente=True)
    check('4b. Control negativo: devolver con el factor VIGENTE dejaría 102 (el test sí discrimina)', stock(w, 'alf') == 102, f'stock={stock(w,"alf")}')

# 5. Eliminación repetida
w = world(); r = sale(w, [item(w, 'x8', 1)]); a = eliminar(w, r['id'])
cu = db.cursor(); cu.execute("insert into pedidos(id,empresa_id,sucursal_id,numero_pedido,fecha_pedido,stock_descontado) select %s,empresa_id,%s,99,current_date,false from sucursales where id=%s", (r['id'], w['suc'], w['suc']))  # el pedido "vuelve" con flag false para simular el reintento del endpoint
b = eliminar(w, r['id'])
dev = [x for x in movs(w) if x[0] == 'devolucion']
check('5. Eliminación repetida devuelve una sola vez (flip atómico)', a == 'devuelto' and b == 'sin_devolucion' and len(dev) == 1 and stock(w, 'alf') == 100, f'{a}/{b} devoluciones={len(dev)} stock={stock(w,"alf")}')

# 6. Pedido anterior a V2 (snapshot NULL)
w = world(stock_alf=90); cu = db.cursor()
cu.execute("insert into pedidos(empresa_id,sucursal_id,numero_pedido,fecha_pedido,stock_descontado) values(%s,%s,1,current_date,true) returning id", (w['emp'], w['suc'])); pid = cu.fetchone()[0]
cu.execute("insert into pedido_items(pedido_id,presentacion_id,cantidad,precio_snap,factor_stock_snap) values(%s,%s,4,1000,NULL)", (pid, w['p1']))
eliminar(w, pid)
check('6. Pedido anterior a V2 (snapshot NULL = factor 1): 4 porciones devuelven 4 (90→94)', stock(w, 'alf') == 94, f'stock={stock(w,"alf")}')
w = world(stock_alf=90, factor_x8=10); cu = db.cursor()   # snapshot NULL aunque la presentación hoy valga 10
cu.execute("insert into pedidos(empresa_id,sucursal_id,numero_pedido,fecha_pedido,stock_descontado) values(%s,%s,1,current_date,true) returning id", (w['emp'], w['suc'])); pid = cu.fetchone()[0]
cu.execute("insert into pedido_items(pedido_id,presentacion_id,cantidad,precio_snap,factor_stock_snap) values(%s,%s,1,7000,NULL)", (pid, w['x8']))
eliminar(w, pid)
check('6b. Snapshot NULL con factor vigente 10: devuelve 1 (NULL = 1, no el vigente)', stock(w, 'alf') == 91, f'stock={stock(w,"alf")}')

# 7. Promoción con componentes (Caja x8 + Lata)
w = world(); cr = str(uuid.uuid4())
comp = [item(w, 'x8', 1, promo_id=str(w['promo']), combo_ref=cr, promo_slot_id=str(w['slot1'])), item(w, 'lata', 1, promo_id=str(w['promo']), combo_ref=cr, promo_slot_id=str(w['slot2']))]
r = sale(w, comp); m = movs(w)
check('7. Promo caja x8 + lata: descuenta 8 y 1, exactamente dos movimientos (ninguno extra)', stock(w, 'alf') == 92 and stock(w, 'beb') == 49 and len(m) == 2, f'alf={stock(w,"alf")} beb={stock(w,"beb")} movs={len(m)}')
check('7b. Promo: snapshots de factor en ambos componentes', sorted(str(x[2]) for x in snaps(r['id'])) == ['1', '8'], str(snaps(r['id'])))

# 8. Pedido de mesa
w = world(); r = sale(w, [item(w, 'x8', 1), item(w, 'p1', 1)], mesa=5); m = movs(w)
cu = db.cursor(); cu.execute("select stock_descontado, numero_mesa, pagado from pedidos where id=%s", (r['id'],)); pe = cu.fetchone()
check('8. Mesa 5: descuenta 9, queda stock_descontado=true y el libro dice "Mesa 5"', stock(w, 'alf') == 91 and pe[0] and 'Mesa 5' in (m[0][2] or ''), f'stock={stock(w,"alf")} {pe} {m[0][2]}')

# 9. Carrito viejo contra stock agotado
w = world(stock_alf=0); ok, msg = raises(lambda: sale(w, [item(w, 'p1', 1)]), 'SIN_STOCK:')
check('9. Carrito viejo con producto agotado → SIN_STOCK (la API lo mapea a 409), sin efectos', ok and not movs(w), msg)

# 10. Dos ventas simultáneas del último stock
w = world(stock_alf=8); bar = threading.Barrier(2); out = []
def worker():
    cn = connect(); bar.wait()
    try: out.append(('ok', sale(w, [item(w, 'x8', 1)], conn=cn)['numero_pedido']))
    except psycopg2.Error as e: out.append(('err', (e.pgerror or '').splitlines()[0]))
    cn.close()
ts = [threading.Thread(target=worker) for _ in range(2)]; [t.start() for t in ts]; [t.join() for t in ts]
oks = [o for o in out if o[0] == 'ok']; errs = [o for o in out if o[0] == 'err']
cu = db.cursor(); cu.execute("select count(*) from pedidos where empresa_id=%s", (w['emp'],)); npe = cu.fetchone()[0]
check('10. Dos ventas simultáneas de Caja x8 con stock 8: pasa una, la otra SIN_STOCK, stock 0, un pedido', len(oks) == 1 and len(errs) == 1 and 'SIN_STOCK' in errs[0][1] and stock(w, 'alf') == 0 and npe == 1, f'{out} stock={stock(w,"alf")} pedidos={npe}')

# 11. Conciliación completa del libro (se evalúa al final sobre un escenario mixto + las anteriores)
w = world(); rs = []
rs.append(sale(w, [item(w, 'x8', 2), item(w, 'p1', 1)])); rs.append(sale(w, [item(w, 'x20', 1)])); rs.append(sale(w, [item(w, 'lata', 4)], mesa=2))
db.cursor().execute("update presentaciones set factor_stock=12 where id=%s", (w['x8'],))
rs.append(sale(w, [item(w, 'x8', 1)])); eliminar(w, rs[0]['id']); eliminar(w, rs[2]['id'])
ok_l, bad = ledger_ok(w)
cu = db.cursor(); cu.execute("""select coalesce(sum(i.cantidad*coalesce(i.factor_stock_snap,1)),0) from pedido_items i join pedidos p on p.id=i.pedido_id
   join presentaciones pr on pr.id=i.presentacion_id where p.empresa_id=%s and pr.producto_id=%s and p.stock_descontado""", (w['emp'], w['alf']))
vivos = int(cu.fetchone()[0])
check('11. Conciliación: stock inicial + Σ movimientos = stock actual; unidades de pedidos vivos = lo descontado neto', ok_l and vivos == 100 - stock(w, 'alf'), f'libro_ok={ok_l} {bad} vivos={vivos} neto={100-stock(w,"alf")}')

# 12. Rollback ante falla tardía (después de descontar stock y crear el pedido)
w = world(); db.cursor().execute("""create or replace function trg_boom() returns trigger language plpgsql as $$ begin if new.nombre_producto_snap='BOOM' then raise exception 'BOOM'; end if; return new; end $$;
  drop trigger if exists boom on pedido_items; create trigger boom before insert on pedido_items for each row execute function trg_boom();""")
ok, msg = raises(lambda: sale(w, [item(w, 'x8', 1), dict(item(w, 'p1', 1), nombre_producto_snap='BOOM')]), 'BOOM')
cu = db.cursor(); cu.execute("select count(*) from pedidos where empresa_id=%s", (w['emp'],)); npe = cu.fetchone()[0]
r = sale(w, [item(w, 'p1', 1)])
check('12. Rollback: una falla al insertar el ítem deshace stock, movimiento y pedido; el número no se consume', ok and stock(w, 'alf') == 99 and npe == 0 and len(movs(w)) == 1 and r['numero_pedido'] == 1, f'{msg} stock={stock(w,"alf")} pedidos_previos={npe} numero={r["numero_pedido"]}')
db.cursor().execute("drop trigger boom on pedido_items")

# 13. Factor fuera de regla (solo v2)
if V2:
    w = world()
    ok, msg = raises(lambda: db.cursor().execute("update presentaciones set factor_stock=2.5 where id=%s", (w['x8'],)), 'presentaciones_factor_stock_entero')
    check('13a. La base rechaza un factor decimal (CHECK entero >= 1)', ok, msg)
    ok, msg = raises(lambda: db.cursor().execute("update presentaciones set factor_stock=0 where id=%s", (w['x8'],)), 'presentaciones_factor_stock')
    check('13b. La base rechaza factor 0', ok, msg)
    db.cursor().execute("alter table presentaciones drop constraint presentaciones_factor_stock_entero")
    db.cursor().execute("update presentaciones set factor_stock=2.5 where id=%s", (w['x8'],))
    ok, msg = raises(lambda: sale(w, [item(w, 'x8', 1)]), 'FACTOR_STOCK_INVALIDO')
    check('13c. Cinturón doble: si el dato se colara, la RPC aborta con FACTOR_STOCK_INVALIDO y sin efectos', ok and stock(w, 'alf') == 100 and not movs(w), msg)
    db.cursor().execute("update presentaciones set factor_stock=1 where id=%s", (w['x8'],))
    db.cursor().execute("alter table presentaciones add constraint presentaciones_factor_stock_entero check (factor_stock = trunc(factor_stock) and factor_stock >= 1)")

# ── CONCURRENCIA Y LOCKS ──
# C1. 12 ventas simultáneas mezcladas, stock suficiente: sin deadlock, números únicos y consecutivos, libro cerrado
w = world(stock_alf=1000, stock_beb=500); out = []; bar = threading.Barrier(12)
def w12(i):
    cn = connect(); bar.wait()
    try:
        its = [item(w, 'x8', 1), item(w, 'lata', 1)] if i % 2 else [item(w, 'lata', 2), item(w, 'p1', 1), item(w, 'x20', 1)]
        out.append(('ok', sale(w, its, conn=cn)['numero_pedido']))
    except psycopg2.Error as e: out.append(('err', (e.pgcode, (e.pgerror or '').splitlines()[0])))
    cn.close()
ts = [threading.Thread(target=w12, args=(i,)) for i in range(12)]; [t.start() for t in ts]; [t.join() for t in ts]
nums = sorted(o[1] for o in out if o[0] == 'ok'); ok_l, bad = ledger_ok(w)
check('C1. 12 ventas simultáneas mezcladas: sin deadlock, números 1..12 únicos, libro cerrado', nums == list(range(1, 13)) and ok_l, f'{[o for o in out if o[0]=="err"]} nums={nums} libro={ok_l}')

# C2. Venta contra otro escritor de stock que toma los productos en ORDEN INVERSO (patrón de Compras/ajustes)
def deadlock_case(orden_inverso):
    w = world(stock_alf=100, stock_beb=100)
    lo, hi = sorted([w['alf'], w['beb']], key=lambda x: str(x))
    first, second = (hi, lo) if orden_inverso else (lo, hi)
    res = {}
    A = connect(autocommit=False); ca = A.cursor()
    ca.execute("select ajustar_stock(%s,%s,%s,1,'delta','ajuste',null,'A1')", (w['emp'], w['suc'], first))
    def venta():
        cn = connect()
        try: sale(w, [item(w, 'x8', 1), item(w, 'lata', 1)], conn=cn); res['sale'] = 'ok'
        except psycopg2.Error as e: res['sale'] = e.pgcode
        cn.close()
    t = threading.Thread(target=venta); t.start(); time.sleep(0.4)
    try:
        ca.execute("select ajustar_stock(%s,%s,%s,1,'delta','ajuste',null,'A2')", (w['emp'], w['suc'], second)); A.commit(); res['A'] = 'ok'
    except psycopg2.Error as e:
        res['A'] = e.pgcode; A.rollback()
    t.join(); A.close(); return res
r_inv = deadlock_case(True); r_ord = deadlock_case(False)
print(f'   (informativo) escritor en orden INVERSO vs venta: {r_inv}; en el MISMO orden: {r_ord}', flush=True)
check('C2a. Mismo orden de productos que la venta (por producto_id): sin deadlock', r_ord == {'sale': 'ok', 'A': 'ok'}, str(r_ord))
check('C2b. HALLAZGO PREEXISTENTE: escritor en orden inverso + trigger bump_catalogo → 40P01 deadlock (una de las dos aborta)', '40P01' in r_inv.values(), str(r_inv))

# C3. Venta contra cambios de factor en paralelo (admin): consistencia descuento = snapshot
w = world(stock_alf=100000, stock_beb=10); stop = threading.Event(); errs = []
def flipper():
    cn = connect(); k = 0
    while not stop.is_set():
        k += 1
        try: cn.cursor().execute("update presentaciones set factor_stock=%s where id=%s", (8 if k % 2 else 10, w['x8']))
        except psycopg2.Error as e: errs.append(('flip', e.pgcode))
    cn.close()
def vendedor():
    cn = connect()
    for _ in range(60):
        try: sale(w, [item(w, 'x8', 1)], conn=cn)
        except psycopg2.Error as e: errs.append(('sale', e.pgcode))
    cn.close()
tf = threading.Thread(target=flipper); tv = [threading.Thread(target=vendedor) for _ in range(3)]
tf.start(); [t.start() for t in tv]; [t.join() for t in tv]; stop.set(); tf.join()
cu = db.cursor(); cu.execute("""select count(*), coalesce(sum(i.cantidad*i.factor_stock_snap),0) from pedido_items i join pedidos p on p.id=i.pedido_id where p.empresa_id=%s""", (w['emp'],)); n, suma_snap = cu.fetchone()
cu.execute("select coalesce(-sum(delta),0) from stock_movimientos where empresa_id=%s and motivo='venta'", (w['emp'],)); descontado = cu.fetchone()[0]
check('C3. 180 ventas mientras un admin cambia el factor 8↔10 sin parar: sin errores y Σ snapshot = Σ descontado', not errs and n == 180 and float(suma_snap) == float(descontado), f'ventas={n} Σsnap={suma_snap} descontado={descontado} errores={errs[:3]}')

# ── resumen ──
tot = len(RESULTS); okc = sum(1 for _, o, _ in RESULTS if o)
print(f'\nRESUMEN modo={MODE}: {okc}/{tot} PASS', flush=True)
if MODE == 'base': print('(en modo base se espera que FALLEN las pruebas que exigen el factor: es el control negativo)')
sys.exit(0)
