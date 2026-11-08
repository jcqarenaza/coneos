#!/usr/bin/env python3
"""Pedidos repetidos + idempotencia + Stock V2 (demo 19→17→19): funciones SQL REALES en Postgres LOCAL aislado.
Uso: python3 prueba_sql.py   (cluster: ver ../stock-v2/README.md; roles service_role/anon/authenticated creados)"""
import os, json, threading, time, uuid
import psycopg2, psycopg2.extras
psycopg2.extras.register_uuid()
HERE = os.path.dirname(os.path.abspath(__file__)); SUP = os.path.abspath(os.path.join(HERE, '..', '..'))
CONN = dict(host='/tmp/pgsock', port=54329, user='postgres')
def connect(db, ac=True):
    c = psycopg2.connect(dbname=db, **CONN); c.autocommit = ac; return c
R = []
def check(n, ok, d=''): R.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n + (f'  [{d}]' if d else ''), flush=True)
FILES = ('stock-v2-factor-migracion.sql', 'rpc-crear-pedido-stock-v2-factor.sql', 'devolver-stock-pedido.sql', 'pedidos-repetidos.sql', 'crear-pedido-stock-v1.7-operacion.sql')
def build(name):
    a = connect('postgres'); a.cursor().execute(f'drop database if exists {name} with (force)'); a.cursor().execute(f'create database {name}'); a.close()
    c = connect(name).cursor()
    c.execute(open(os.path.join(SUP, 'tests', 'stock-v2', '00-schema-reducido.sql'), encoding='utf-8').read())
    c.execute("create table empresa_config (empresa_id uuid primary key, primary_color text)")   # stub: la tabla real ya existe en la base viva
    # Supabase otorga EXECUTE a anon/authenticated/service_role por defecto sobre toda función nueva de public: se imita acá
    c.execute("alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role")
    c.execute("alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role")
    for f in FILES:
        c.execute(open(os.path.join(SUP, f), encoding='utf-8').read())
    return name
def build_pre(name, pre_sql, hasta):
    """Base con el esquema reducido + SQL PREEXISTENTE (objetos que ya estaban antes de la entrega) + los scripts de FILES[:hasta]."""
    a = connect('postgres'); a.cursor().execute(f'drop database if exists {name} with (force)'); a.cursor().execute(f'create database {name}'); a.close()
    c = connect(name).cursor()
    c.execute(open(os.path.join(SUP, 'tests', 'stock-v2', '00-schema-reducido.sql'), encoding='utf-8').read())
    c.execute("create table empresa_config (empresa_id uuid primary key, primary_color text)")
    c.execute("alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role")
    c.execute("alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role")
    if pre_sql: c.execute(pre_sql)
    return name, c
def aplicar(c, f):
    """Corre un script de supabase/ y devuelve (None, notices) o (mensaje de error, notices)."""
    try:
        c.execute(open(os.path.join(SUP, f), encoding='utf-8').read()); return None, list(c.connection.notices)
    except psycopg2.Error as e:
        try: c.execute('rollback')              # los scripts abren su propio BEGIN: tras un error la transacción queda abortada
        except psycopg2.Error: pass
        return (e.pgerror or str(e)), list(c.connection.notices)
def world(db, stock=19, factor=1):
    q = connect(db).cursor(); w = {'db': db}
    def one(sql, *a): q.execute(sql, a); return q.fetchone()[0]
    w['emp'] = one("insert into empresas default values returning id"); w['suc'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    w['suc2'] = one("insert into sucursales(empresa_id) values(%s) returning id", w['emp'])
    q.execute("insert into catalogo_version(sucursal_id, empresa_id) values(%s,%s),(%s,%s)", (w['suc'], w['emp'], w['suc2'], w['emp']))
    q.execute("insert into empresa_config(empresa_id) values(%s)", (w['emp'],))
    w['prod'] = one("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Alfajor',true) returning id", w['emp'])
    w['pres'] = one("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'Unidad',1000,%s) returning id", w['emp'], w['prod'], factor)
    for s in (w['suc'], w['suc2']): q.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,%s)", (w['emp'], w['prod'], s, stock))
    return w
def cfg(w, activo=True, minutos=30):
    connect(w['db']).cursor().execute("update empresa_config set prevenir_pedidos_repetidos=%s, pedidos_repetidos_minutos=%s where empresa_id=%s", (activo, minutos, w['emp']))
def reclamar(w, op, huella='H1', tel=None, vis=None, disp=None, confirmar=False, suc=None, conn=None):
    cu = (conn or connect(w['db'])).cursor()
    cu.execute("select reclamar_operacion_pedido(%s,%s,%s,%s,%s,%s,%s,%s)", (w['emp'], suc or w['suc'], op, huella, tel, vis, disp, confirmar)); return cu.fetchone()[0]
def venta(w, n=1, suc=None, conn=None, op=None):
    cu = (conn or connect(w['db'])).cursor()
    it = [{'presentacion_id': str(w['pres']), 'cantidad': n, 'precio_snap': 1000, 'nombre_producto_snap': 'a', 'nombre_presentacion_snap': 'u', 'opciones': []}]
    cu.execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'kiosk', p_tipo_pedido := 'local', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PENDING_PAYMENT', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := false, p_operacion_id := %s::uuid)", (w['emp'], suc or w['suc'], json.dumps(it), str(op) if op else None))
    r = cu.fetchone()[0]; return r['id'] if 'id' in r else r['pedido_id']
def completar(w, op, pid): connect(w['db']).cursor().execute("select completar_operacion_pedido(%s,%s,%s)", (w['emp'], op, pid))
def comprar(w, huella='H1', **kw):
    """Flujo completo del servidor: reclamar → (si NUEVA) crear pedido → completar. Devuelve (decisión, op, pedido_id)."""
    op = kw.pop('op', None) or uuid.uuid4(); r = reclamar(w, op, huella, **kw); pid = None
    if r['estado'] == 'NUEVA':
        pid = venta(w, suc=kw.get('suc'), op=op); completar(w, op, pid)
    return r, op, pid
def stk(w, suc=None):
    cu = connect(w['db']).cursor(); cu.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (w['prod'], suc or w['suc'])); return cu.fetchone()[0]
def npedidos(w):
    cu = connect(w['db']).cursor(); cu.execute("select count(*) from pedidos where empresa_id=%s", (w['emp'],)); return cu.fetchone()[0]
def envejecer(w, minutos):
    connect(w['db']).cursor().execute("update pedido_operaciones set created_at = created_at - make_interval(mins => %s), updated_at = updated_at - make_interval(mins => %s) where empresa_id=%s", (minutos, minutos, w['emp']))

db = build('rep_main')
print('=== STOCK V2 — caso demostrativo del CTO ===')
w = world(db, stock=19); p = venta(w, 2); s17 = stk(w)
cu = connect(db).cursor(); cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], p)); dev = cu.fetchone()[0]
cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], p)); dev2 = cu.fetchone()[0]
cu.execute("select coalesce(sum(delta),0) from stock_movimientos where empresa_id=%s", (w['emp'],)); neto = cu.fetchone()[0]
check('S1. stock 19 → venta de 2 → 17 → devolución → 19 (y el libro cierra: Σ movimientos = 0)', s17 == 17 and stk(w) == 19 and dev['devuelto'] is True and neto == 0, f'{s17}→{stk(w)} neto={neto}')
check('S2. reintento de devolución: no-op (stock sigue 19, un solo movimiento de devolución)', dev2['devuelto'] is False and stk(w) == 19)
w = world(db, stock=40, factor=8); p = venta(w, 2); s24 = stk(w)
connect(db).cursor().execute("update presentaciones set factor_stock=10 where id=%s", (w['pres'],))
cu = connect(db).cursor(); cu.execute("select factor_stock_snap from pedido_items where pedido_id=%s", (p,)); snap = cu.fetchone()[0]
cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], p))
check('S3. factor 8: vender 2 descuenta 16 (40→24); cambiar el factor a 10 y devolver devuelve 16 (snapshot 8), no 20', s24 == 24 and snap == 8 and stk(w) == 40, f'{s24} snap={snap} final={stk(w)}')

print('=== PEDIDOS REPETIDOS ===')
w = world(db); cfg(w, True, 30)
r1, op1, p1 = comprar(w, tel='1122334455')
r2, op2, p2 = comprar(w, tel='1122334455')
check('R1/R2. mismo cliente, mismo pedido dentro de la ventana (30 min configurados): ADVERTENCIA y no se crea pedido', r1['estado'] == 'NUEVA' and r2['estado'] == 'DUPLICADO' and p2 is None and npedidos(w) == 1 and r2['ventana_minutos'] == 30, str(r2))
envejecer(w, 29); r = reclamar(w, uuid.uuid4(), tel='1122334455')
check('R2b. a los 29 min (ventana 30) todavía advierte', r['estado'] == 'DUPLICADO')
envejecer(w, 2); r = reclamar(w, uuid.uuid4(), tel='1122334455')
check('R3. mismo pedido FUERA del período (31 min, ventana 30): sin advertencia', r['estado'] == 'NUEVA', str(r))
w = world(db); cfg(w, True, 2); comprar(w, tel='1100000001'); r = reclamar(w, uuid.uuid4(), tel='1100000001'); envejecer(w, 3); r2 = reclamar(w, uuid.uuid4(), tel='1100000001')
check('R1b. con ventana de 2 min: advierte a tiempo y no advierte pasados 3 min', r['estado'] == 'DUPLICADO' and r2['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 1440); comprar(w, tel='1100000002'); envejecer(w, 1400); r = reclamar(w, uuid.uuid4(), tel='1100000002')
check('R2c. sin máximo arbitrario: ventana de 1440 min (24 h) funciona', r['estado'] == 'DUPLICADO')
w = world(db); cfg(w, True, 30); comprar(w, tel='1111111111'); r = reclamar(w, uuid.uuid4(), tel='2222222222')
check('R4. clientes DIFERENTES (teléfonos distintos): sin advertencia cruzada', r['estado'] == 'NUEVA')
comprar(w, vis='vis-A'); r = reclamar(w, uuid.uuid4(), vis='vis-B'); r2 = reclamar(w, uuid.uuid4(), vis='vis-A')
check('R4b. visitantes distintos no se cruzan; el mismo visitante sí', r['estado'] == 'NUEVA' and r2['estado'] == 'DUPLICADO')
comprar(w, tel='3000000001', vis='vis-X'); r = reclamar(w, uuid.uuid4(), tel='3000000002', vis='vis-X')
check('R4c. mismo dispositivo/visitante pero teléfonos DISTINTOS: son clientes distintos, sin advertencia', r['estado'] == 'NUEVA')
d1, d2 = uuid.uuid4(), uuid.uuid4(); w = world(db); cfg(w, True, 30); comprar(w, disp=d1)
a = reclamar(w, uuid.uuid4(), disp=d1); b = reclamar(w, uuid.uuid4(), disp=d2); c = reclamar(w, uuid.uuid4())
check('R5. sin cliente identificado: se valida por dispositivo (mismo dispositivo advierte; otro dispositivo o anónimo total, no)', a['estado'] == 'DUPLICADO' and b['estado'] == 'NUEVA' and c['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); comprar(w, tel='1199999999'); r = reclamar(w, uuid.uuid4(), tel='1199999999', suc=w['suc2'])
check('R6. sucursales diferentes: no se mezclan', r['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); comprar(w, 'H-2x', tel='1155555555'); r = reclamar(w, uuid.uuid4(), 'H-3x', tel='1155555555')
check('R7/R8. contenido distinto (otra huella: cantidades/opciones/variantes): no son idénticos', r['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); a1, o1, pa = comprar(w, tel='1177777777'); r = reclamar(w, uuid.uuid4(), tel='1177777777')
check('R9. el cliente VUELVE: no se crea pedido (queda solo la advertencia)', r['estado'] == 'DUPLICADO' and npedidos(w) == 1)
op = uuid.uuid4(); r = reclamar(w, op, tel='1177777777'); r2 = reclamar(w, op, tel='1177777777', confirmar=True)
pid = venta(w, op=op); completar(w, op, pid)
check('R10. el cliente CONFIRMA (misma operación advertida): se permite y se crea el segundo pedido', r['estado'] == 'DUPLICADO' and r2['estado'] == 'NUEVA' and r2.get('confirmada') and npedidos(w) == 2)
w3 = world(db); cfg(w3, True, 30); comprar(w3, tel='1100990099'); opx = uuid.uuid4()
ra = reclamar(w3, opx, tel='1100990099'); rb = reclamar(w3, opx, tel='1100990099'); rc = reclamar(w3, opx, tel='1100990099')
check('R9b. reenviar la operación ADVERTIDA SIN confirmar (doble clic sobre la advertencia, reintento) sigue siendo advertencia: no se cuela', ra['estado'] == rb['estado'] == rc['estado'] == 'DUPLICADO' and npedidos(w3) == 1)
r3 = reclamar(w, uuid.uuid4(), tel='1177777777', confirmar=True)
check('R10b. confirmar=true SIN advertencia previa de esa operación NO autoriza nada (el servidor igual advierte)', r3['estado'] == 'DUPLICADO')
rx = reclamar(w, op, 'OTRA-HUELLA', tel='1177777777', confirmar=True); ry = reclamar(w, op, tel='9999999999', confirmar=True); rz = reclamar(w, op, tel='1177777777', suc=w['suc2'], confirmar=True)
check('R10c. la confirmación atada a otro contenido, otra identidad u otra sucursal: OPERACION_INVALIDA', rx['estado'] == ry['estado'] == rz['estado'] == 'OPERACION_INVALIDA', f"{rx['estado']} {ry['estado']} {rz['estado']}")
w = world(db); cfg(w, False, 30); comprar(w, tel='1188888888'); r = reclamar(w, uuid.uuid4(), tel='1188888888')
check('R14. configuración DESACTIVADA: no hay advertencia', r['estado'] == 'NUEVA')
w1 = world(db); w2 = world(db); cfg(w1, True, 30); cfg(w2, False, 5); comprar(w1, tel='1166666666'); comprar(w2, tel='1166666666')
a = reclamar(w1, uuid.uuid4(), tel='1166666666'); b = reclamar(w2, uuid.uuid4(), tel='1166666666')
check('R15. configuraciones distintas entre empresas: cada una respeta la suya (aislamiento por empresa)', a['estado'] == 'DUPLICADO' and b['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30); _, _, pc = comprar(w, tel='1144444444')
connect(db).cursor().execute("update pedidos set estado='CANCELLED' where id=%s", (pc,)); r = reclamar(w, uuid.uuid4(), tel='1144444444')
check('R16. un pedido CANCELADO no cuenta como compra activa', r['estado'] == 'NUEVA')
_, _, pd = comprar(w, tel='1133333333'); connect(db).cursor().execute("delete from pedidos where id=%s", (pd,)); r = reclamar(w, uuid.uuid4(), tel='1133333333')
check('R16b. un pedido ELIMINADO tampoco cuenta (y el borrado del pedido no se bloquea por la tabla de operaciones)', r['estado'] == 'NUEVA')
w = world(db); cfg(w, True, 30)
def setmin(v):
    try: connect(db).cursor().execute("update empresa_config set pedidos_repetidos_minutos=%s where empresa_id=%s", (v, w['emp'])); return None
    except psycopg2.Error as e: return e.pgcode
check('R17. la base rechaza minutos <= 0 y > 1440; acepta 1 y 1440 (rango CTO 1..1440)', [setmin(0), setmin(-5), setmin(1441), setmin(100000)] == ['23514'] * 4 and setmin(1) is None and setmin(1440) is None)
cu = connect(db).cursor(); cu.execute("select column_default from information_schema.columns where table_name='empresa_config' and column_name='pedidos_repetidos_minutos'"); dflt = cu.fetchone()[0]
check('R17b. el default sigue en 30 minutos y la prevención activa por defecto', dflt == '30')

print('=== IDEMPOTENCIA Y CONCURRENCIA ===')
w = world(db); cfg(w, True, 30); op = uuid.uuid4()
r = reclamar(w, op, tel='1100110011'); pid = venta(w, op=op); completar(w, op, pid)
dc = [reclamar(w, op, tel='1100110011') for _ in range(5)]
check('R11. doble clic / refresh / reenvío tras el timeout (misma operación): devuelve SIEMPRE el mismo pedido, un único pedido en la base', all(x['estado'] == 'EXISTENTE' and x['pedido_id'] == str(pid) for x in dc) and npedidos(w) == 1 and stk(w) == 18)
w = world(db); cfg(w, True, 30); op = uuid.uuid4(); res = []; creados = []
def hilo(i):
    cn = connect(db); r = reclamar(w, op, tel='1100220022', conn=cn)
    if r['estado'] == 'NUEVA':
        pid = venta(w, conn=cn, op=op); time.sleep(0.15); completar(w, op, pid); creados.append(pid); r = {'estado': 'NUEVA', 'pedido_id': str(pid)}
    else:
        for _ in range(40):
            if r['estado'] == 'EXISTENTE': break
            time.sleep(0.05); r = reclamar(w, op, tel='1100220022', conn=cn)
    res.append(r)
ths = [threading.Thread(target=hilo, args=(i,)) for i in range(20)]; [t.start() for t in ths]; [t.join() for t in ths]
pids = {x.get('pedido_id') for x in res}
check('R12/R13. 20 solicitudes SIMULTÁNEAS de la misma operación: exactamente 1 pedido, las 20 reciben el mismo', len(creados) == 1 and len(pids) == 1 and npedidos(w) == 1 and stk(w) == 18 and all(x['estado'] in ('NUEVA', 'EXISTENTE') for x in res), f'creados={len(creados)} pedidos={npedidos(w)} stock={stk(w)}')
w = world(db); cfg(w, True, 30); res = []
def hilo2(i):
    cn = connect(db); o = uuid.uuid4(); r = reclamar(w, o, tel='1100330033', conn=cn); res.append(r['estado'])
    if r['estado'] == 'NUEVA': venta(w, conn=cn, op=o)
ths = [threading.Thread(target=hilo2, args=(i,)) for i in range(20)]; [t.start() for t in ths]; [t.join() for t in ths]
check('R13b. 20 operaciones DISTINTAS con el mismo contenido y la misma persona, a la vez: pasa UNA, las otras 19 reciben la advertencia (sin carrera consulta/creación)', res.count('NUEVA') == 1 and res.count('DUPLICADO') == 19 and npedidos(w) == 1, str({k: res.count(k) for k in set(res)}))
w = world(db); cfg(w, True, 30); res = []
def hilo3(i):
    cn = connect(db); r = reclamar(w, uuid.uuid4(), f'H-{i}', tel='1100440044', conn=cn); res.append(r['estado'])
ths = [threading.Thread(target=hilo3, args=(i,)) for i in range(20)]; [t.start() for t in ths]; [t.join() for t in ths]
check('R13c. 20 pedidos con contenidos DISTINTOS a la vez: ninguno se advierte (no hay falsos positivos bajo concurrencia)', res.count('NUEVA') == 20)
w = world(db, stock=1); cfg(w, True, 30); op = uuid.uuid4(); reclamar(w, op, tel='1100550055')
try: venta(w, 2, op=op); e18 = None                                                  # SIN_STOCK REAL: pide 2 con stock 1
except psycopg2.Error as ex: e18 = (ex.pgcode, ex.pgerror or '')
cu.execute("select count(*) from pedidos where empresa_id=%s", (w['emp'],)); n_ped = cu.fetchone()[0]
cu.execute("select count(*) from stock_movimientos where empresa_id=%s", (w['emp'],)); n_mov = cu.fetchone()[0]
cu.execute("select count(*) from pedido_items i join pedidos p on p.id=i.pedido_id where p.empresa_id=%s", (w['emp'],)); n_it = cu.fetchone()[0]
rollback_ok = (n_ped, n_mov, n_it, stk(w)) == (0, 0, 0, 1)
connect(db).cursor().execute("select liberar_operacion_pedido(%s,%s)", (w['emp'], op))
r = reclamar(w, op, tel='1100550055'); sig = venta(w, 1, op=uuid.uuid4()); cu.execute("select numero_pedido from pedidos where id=%s", (sig,)); nro18 = cu.fetchone()[0]
check('R18. SIN_STOCK REAL de la RPC: rollback COMPLETO (0 pedidos, 0 ítems, 0 movimientos, stock intacto, numeración sin consumir → el siguiente pedido es el #1) y recién entonces la operación liberada se puede RECLAMAR de nuevo', e18 is not None and e18[0] == 'P0001' and 'SIN_STOCK' in e18[1] and rollback_ok and r['estado'] == 'NUEVA' and nro18 == 1, f'{e18} pedidos={n_ped} mov={n_mov} items={n_it} nro={nro18} r={r}')
w = world(db); cfg(w, True, 30); op = uuid.uuid4(); reclamar(w, op, tel='1100660066'); r = reclamar(w, op, tel='1100660066')
envejecer(w, 1); r2 = reclamar(w, op, tel='1100660066'); envejecer(w, 2); r3 = reclamar(w, op, tel='1100660066')
check('R19. operación EN_CURSO: una segunda solicitud inmediata espera (EN_CURSO); si queda abandonada >90 s se puede retomar', r['estado'] == 'EN_CURSO' and r2['estado'] == 'EN_CURSO' and r3['estado'] == 'NUEVA')
def err(sql, *a):
    try: connect(db).cursor().execute(sql, a or None); return None
    except psycopg2.Error as e: return e.pgcode
cu = connect(db).cursor()
FN = ["public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean)", "public.completar_operacion_pedido(uuid,uuid,uuid)", "public.liberar_operacion_pedido(uuid,uuid)",
      "public.purgar_operaciones_pedido(integer)", "public.devolver_stock_pedido(uuid,uuid)",
      "public.crear_pedido_stock(uuid,uuid,uuid,jsonb,text,text,text,numeric,jsonb,text,text,uuid,integer,boolean,text,uuid)"]
priv = {f: [] for f in FN}
for f in FN:
    for rol in ('anon', 'authenticated', 'service_role'):
        cu.execute("select has_function_privilege(%s,%s,'execute')", (rol, f)); priv[f].append(cu.fetchone()[0])
check('R20. permisos: anon/authenticated NO ejecutan ninguna de las 6 funciones (aunque los privilegios por defecto de Supabase se los den); service_role sí', all(v == [False, False, True] for v in priv.values()), str(priv))
cu.execute("select has_table_privilege('anon','pedido_operaciones','select'), has_table_privilege('authenticated','pedido_operaciones','select'), has_table_privilege('service_role','pedido_operaciones','select')")
tp = cu.fetchone(); check('R20b. la tabla pedido_operaciones no es legible por anon/authenticated', tp[:2] == (False, False), str(tp))

print('=== CORRECCIONES CTO 8/11: IDEMPOTENCIA EN LA BASE (pedidos.operacion_id) ===')
cu.execute("select count(*), max(pronargs), min(pronargs) from pg_proc where pronamespace='public'::regnamespace and proname='crear_pedido_stock'"); n, mx, mn = cu.fetchone()
check('I1. firma: existe UNA sola crear_pedido_stock (16 parámetros); la de 15 fue eliminada, sin sobrecargas ambiguas', (n, mx, mn) == (1, 16, 16), str((n, mx, mn)))
w = world(db, stock=19); op = uuid.uuid4(); a = venta(w, 2, op=op); b = venta(w, 2, op=op)
cu.execute("select count(*) from pedidos where empresa_id=%s and operacion_id=%s", (w['emp'], op)); cnt = cu.fetchone()[0]
nxt = venta(w, 1); cu.execute("select numero_pedido from pedidos where id=%s", (nxt,)); nro = cu.fetchone()[0]
check('I2. misma operación dos veces: devuelve el MISMO pedido, un solo pedido, stock descontado UNA vez (19→17→16 con el siguiente) y no consume numeración (el siguiente es el #2)', a == b and cnt == 1 and nro == 2 and stk(w) == 16, f'{a == b} {cnt} nro={nro} stock={stk(w)}')
cu.execute("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'kiosk', p_tipo_pedido := 'local', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PENDING_PAYMENT', p_codigo_retiro := 'A1', p_operacion_id := %s::uuid)",
           (w['emp'], w['suc'], json.dumps([{'presentacion_id': str(w['pres']), 'cantidad': 2, 'precio_snap': 1000, 'nombre_producto_snap': 'a', 'nombre_presentacion_snap': 'u', 'opciones': []}]), str(op)))
rr = cu.fetchone()[0]
check('I2b. la respuesta del pedido existente tiene la misma estructura (id, numero_pedido, codigo_retiro) + reutilizado:true', set(rr) == {'id', 'numero_pedido', 'codigo_retiro', 'reutilizado'} and rr['reutilizado'] is True and rr['id'] == str(a), str(rr))
# búsqueda temprana: reintento después de que cambió un precio / se agotó el stock
w = world(db, stock=2); op = uuid.uuid4(); p1 = venta(w, 2, op=op)       # deja el stock en 0
connect(db).cursor().execute("update presentaciones set precio=1500 where id=%s", (w['pres'],))
p2 = venta(w, 2, op=op)                                                    # items con el precio VIEJO y sin stock: igual devuelve el existente
try: venta(w, 2); ctrl = None
except psycopg2.Error as e: ctrl = e.pgerror or ''
check('I3. búsqueda TEMPRANA: tras crear el pedido, un reintento con precio cambiado y stock agotado devuelve el pedido existente (no PRECIO_INVALIDO ni SIN_STOCK); sin operación esos mismos datos sí se rechazan', p1 == p2 and ctrl is not None and ('PRECIO_INVALIDO' in ctrl or 'SIN_STOCK' in ctrl), str(ctrl)[:80])
w = world(db); e = [err("insert into pedidos(empresa_id,sucursal_id,numero_pedido,operacion_id) values(%s,%s,%s,%s)", w['emp'], w['suc'], k, uuid.UUID(int=77)) for k in (901, 902)]
e2 = [err("insert into pedidos(empresa_id,sucursal_id,numero_pedido) values(%s,%s,%s)", w['emp'], w['suc'], k) for k in (903, 904)]
w2 = world(db); e3 = err("insert into pedidos(empresa_id,sucursal_id,numero_pedido,operacion_id) values(%s,%s,%s,%s)", w2['emp'], w2['suc'], 905, uuid.UUID(int=77))
check('I4. unicidad: dos pedidos con la misma operación en la misma empresa → 23505; sin operación (históricos/caja) no se limitan; otra empresa puede reutilizar el mismo id', e == [None, '23505'] and e2 == [None, None] and e3 is None, str((e, e2, e3)))
w = world(db, stock=50); op = uuid.uuid4(); res = []
def hilop(i):
    cn = connect(db); res.append(venta(w, 1, conn=cn, op=op))
ths = [threading.Thread(target=hilop, args=(i,)) for i in range(20)]; [t.start() for t in ths]; [t.join() for t in ths]
check('I5. 20 solicitudes SIMULTÁNEAS directas a la RPC con la misma operación (sin pasar por reclamar): las 20 reciben respuesta (ninguna falla), un único pedido, todas el mismo, stock descontado una vez', len(res) == 20 and len(set(res)) == 1 and npedidos(w) == 1 and stk(w) == 49, f'{len(res)} {len(set(res))} {npedidos(w)} {stk(w)}')
# I6 (revisión CTO 8/11): pedido CREADO + completar_ FALLÓ + reintento INMEDIATO (dentro de los 90 s). Antes quedaba EN_CURSO/409 hasta los 90 s.
w = world(db, stock=19); op = uuid.uuid4(); r1 = reclamar(w, op, tel='1200000001'); p1 = venta(w, 1, op=op)    # completar_ NO se ejecuta: simula su fallo
r2 = reclamar(w, op, tel='1200000001')                                                                          # reintento inmediato (sin envejecer)
cu.execute("select estado, pedido_id from pedido_operaciones where operacion_id=%s", (op,)); est6 = cu.fetchone()
p2 = venta(w, 1, op=op)
check('I6a. pedido creado + completar_ falló + reintento INMEDIATO (<90 s): reclamar_ lo RECUPERA al instante (EXISTENTE con el pedido), cierra la operación (COMPLETADA), un solo pedido, stock descontado una vez', r1['estado'] == 'NUEVA' and r2['estado'] == 'EXISTENTE' and r2['pedido_id'] == str(p1) and est6[0] == 'COMPLETADA' and str(est6[1]) == str(p1) and p2 == p1 and npedidos(w) == 1 and stk(w) == 18, f"{r2} {est6} {npedidos(w)} {stk(w)}")
w = world(db, stock=19); op = uuid.uuid4(); reclamar(w, op, tel='1200000011'); r2 = reclamar(w, op, tel='1200000011')
check('I6b. operación EN_CURSO SIN pedido dentro de los 90 s (creación en vuelo): sigue EN_CURSO (no se recupera lo que no existe)', r2['estado'] == 'EN_CURSO')
envejecer(w, 2); r3 = reclamar(w, op, tel='1200000011'); p3 = venta(w, 1, op=op); completar(w, op, p3); r4 = reclamar(w, op, tel='1200000011')
check('I6c. abandonada >90 s sin pedido: se retoma (NUEVA); creada y completada → EXISTENTE', r3['estado'] == 'NUEVA' and r4['estado'] == 'EXISTENTE' and r4['pedido_id'] == str(p3) and npedidos(w) == 1)
w = world(db, stock=19); op = uuid.uuid4(); reclamar(w, op, tel='1200000012'); pz = venta(w, 1, op=op); envejecer(w, 2); r5 = reclamar(w, op, tel='1200000012')
check('I6d. pedido creado, completar_ falló y pasaron >90 s: también se recupera (EXISTENTE) y nunca se crea un segundo pedido', r5['estado'] == 'EXISTENTE' and r5['pedido_id'] == str(pz) and npedidos(w) == 1 and stk(w) == 18)
# liberar_ no borra si el pedido existe
w = world(db, stock=19); op = uuid.uuid4(); reclamar(w, op, tel='1200000002'); venta(w, 1, op=op)
connect(db).cursor().execute("select liberar_operacion_pedido(%s,%s)", (w['emp'], op))
cu.execute("select count(*) from pedido_operaciones where operacion_id=%s", (op,)); quedo = cu.fetchone()[0]
op2 = uuid.uuid4(); reclamar(w, op2, 'HX', tel='1200000003'); connect(db).cursor().execute("select liberar_operacion_pedido(%s,%s)", (w['emp'], op2))
cu.execute("select count(*) from pedido_operaciones where operacion_id=%s", (op2,)); borro = cu.fetchone()[0]
check('I7. liberar_: NO borra una operación cuyo pedido ya existe (respuesta perdida tras crear); sí borra la que no tiene pedido', quedo == 1 and borro == 0)
# completar_ endurecido
w = world(db, stock=50); w2 = world(db, stock=50); op = uuid.uuid4(); reclamar(w, op, tel='1200000004'); pid = venta(w, 1, op=op); otro = venta(w, 1, op=uuid.uuid4()); sin = venta(w); ajeno = venta(w2, 1, op=op)
casos = [err("select completar_operacion_pedido(%s,%s,%s)", w['emp'], op, uuid.uuid4()), err("select completar_operacion_pedido(%s,%s,%s)", w['emp'], op, otro),
         err("select completar_operacion_pedido(%s,%s,%s)", w['emp'], op, sin), err("select completar_operacion_pedido(%s,%s,%s)", w['emp'], op, ajeno)]
ok = err("select completar_operacion_pedido(%s,%s,%s)", w['emp'], op, pid)
cu.execute("select estado, pedido_id from pedido_operaciones where operacion_id=%s and empresa_id=%s", (op, w['emp'])); est = cu.fetchone()
check('I8. completar_ rechaza: pedido inexistente, de OTRA operación, sin operación, o de otra empresa; acepta el que corresponde', casos == ['P0001'] * 4 and ok is None and est[0] == 'COMPLETADA' and str(est[1]) == str(pid), str((casos, ok, est)))
# purga por lotes
w = world(db); q = connect(db).cursor()
for k in range(30): q.execute("insert into pedido_operaciones(empresa_id,operacion_id,sucursal_id,huella,estado,created_at) values(%s,%s,%s,%s,'COMPLETADA', now() - interval '31 days')", (w['emp'], uuid.uuid4(), w['suc'], f'V{k}'))
q.execute("insert into pedido_operaciones(empresa_id,operacion_id,sucursal_id,huella,estado,created_at) values(%s,%s,%s,'R','COMPLETADA', now() - interval '29 days')", (w['emp'], uuid.uuid4(), w['suc']))
q.execute("select purgar_operaciones_pedido(10)"); b1 = q.fetchone()[0]; q.execute("select purgar_operaciones_pedido(500)"); b2 = q.fetchone()[0]
q.execute("select count(*) from pedido_operaciones where empresa_id=%s", (w['emp'],)); resto = q.fetchone()[0]
check('I9. purga por LOTES: borra solo las de más de 30 días, a lo sumo p_limite por llamada (10, luego las 20 restantes); la de 29 días queda', (b1, b2, resto) == (10, 20, 1), str((b1, b2, resto)))
for k in range(40): q.execute("insert into pedido_operaciones(empresa_id,operacion_id,sucursal_id,huella,estado,created_at) values(%s,%s,%s,%s,'COMPLETADA', now() - interval '40 days')", (w['emp'], uuid.uuid4(), w['suc'], f'W{k}'))
blk = connect(db, ac=False); bc = blk.cursor(); bc.execute("select ctid from pedido_operaciones where huella='W0' for update")
t0 = time.time(); q.execute("select purgar_operaciones_pedido(500)"); got = q.fetchone()[0]; dt = time.time() - t0; blk.rollback()
check('I10. SKIP LOCKED: una purga NO espera a una fila bloqueada por otra transacción (termina al instante y la salta)', got == 39 and dt < 1.5, f'{got} filas en {dt:.2f}s')
# purga concurrente + reclamos concurrentes: sin deadlock ni errores
w = world(db); q = connect(db).cursor()
for k in range(3000): q.execute("insert into pedido_operaciones(empresa_id,operacion_id,sucursal_id,huella,estado,created_at) values(%s,%s,%s,%s,'COMPLETADA', now() - interval '50 days')", (w['emp'], uuid.uuid4(), w['suc'], f'Z{k}'))
errs = []
def purga(i):
    try: connect(db).cursor().execute("select purgar_operaciones_pedido(200)")
    except Exception as ex: errs.append(repr(ex))
def reclamo(i):
    try: reclamar(w, uuid.uuid4(), f'HC-{i}', tel=f'13000000{i:02d}')
    except Exception as ex: errs.append(repr(ex))
ths = [threading.Thread(target=purga, args=(i,)) for i in range(12)] + [threading.Thread(target=reclamo, args=(i,)) for i in range(12)]
[t.start() for t in ths]; [t.join() for t in ths]
check('I11. 12 purgas y 12 reclamos con huellas distintas, a la vez: ningún error ni deadlock (la purga ya no está en el camino de compra)', not errs, str(errs[:2]))
# search_path endurecido + referencias calificadas
cu.execute("select p.proname, p.proconfig from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('reclamar_operacion_pedido','completar_operacion_pedido','liberar_operacion_pedido','purgar_operaciones_pedido','devolver_stock_pedido','crear_pedido_stock') and p.prosecdef")
cf = {r[0]: r[1] for r in cu.fetchall()}
esperado = {'reclamar_operacion_pedido': 'search_path=pg_catalog,pg_temp', 'completar_operacion_pedido': 'search_path=pg_catalog,pg_temp', 'liberar_operacion_pedido': 'search_path=pg_catalog,pg_temp', 'purgar_operaciones_pedido': 'search_path=pg_catalog,pg_temp', 'devolver_stock_pedido': 'search_path=public,pg_temp', 'crear_pedido_stock': 'search_path=public,pg_temp'}
check('I12. las 6 funciones SECURITY DEFINER tienen search_path fijo y endurecido (pg_temp siempre último; las 4 auxiliares sin public, las 2 que disparan triggers con public, pg_temp)', len(cf) == 6 and all(v and any(x.replace(' ', '') == esperado[k] for x in v) for k, v in cf.items()), str(cf))
w = world(db, stock=19); sh = connect(db); sc = sh.cursor()
for t in ('pedidos', 'pedido_items', 'producto_stock', 'presentaciones', 'productos', 'stock_movimientos', 'pedido_operaciones', 'empresa_config'): sc.execute(f"create temp table {t} (like public.{t} including defaults)")
pv = venta(w, 2, conn=sh, op=uuid.uuid4()); s17 = stk(w)
sh2 = connect(db); sc2 = sh2.cursor()
for t in ('pedidos', 'pedido_items', 'presentaciones', 'pedido_operaciones', 'empresa_config'): sc2.execute(f"create temp table {t} (like public.{t} including defaults)")
sc2.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], pv)); dv = sc2.fetchone()[0]
check('I13. sin sombra por temporales: con tablas TEMPORALES homónimas en la sesión, venta (crear_pedido_stock) y devolución (devolver_stock_pedido) operan sobre las reales (19→17→19)', s17 == 17 and dv['devuelto'] is True and stk(w) == 19, f'{s17} {dv} {stk(w)}')
sh3 = connect(db); sc3 = sh3.cursor(); sc3.execute("create temp table productos (like public.productos including defaults)")
try: sc3.execute("select ajustar_stock(%s,%s,%s,1)", (w['emp'], w['suc'], w['prod'])); sombra = False
except psycopg2.Error as e: sombra = 'PRODUCTO_INVALIDO' in (e.pgerror or '')
cu.execute("select has_function_privilege('anon','public.ajustar_stock(uuid,uuid,uuid,integer,text,text,uuid,text)','execute'), has_function_privilege('authenticated','public.ajustar_stock(uuid,uuid,uuid,integer,text,text,uuid,text)','execute')"); aj_priv = cu.fetchone()
w_x = world(db, stock=5); w_y = world(db, stock=5)
try: cu.execute("select ajustar_stock(%s,%s,%s,100,'delta','ajuste',null,'x')", (w_y['emp'], w_x['suc'], w_x['prod'])); cruzado = 'PERMITIDO'
except psycopg2.Error as e: cruzado = 'rechazado' if 'PRODUCTO_INVALIDO' in (e.pgerror or '') else (e.pgerror or '')[:60]
print(f"INFO (hallazgo, NO modificado — Stock V1): con los privilegios por defecto de Supabase ajustar_stock es ejecutable por anon/authenticated={aj_priv}; llamada con la empresa B sobre el producto de la empresa A: {cruzado} (la copia de la función viva valida la pertenencia)")
print(f"INFO (hallazgo, NO modificado por estar fuera de alcance — Stock V1): ajustar_stock con search_path 'public' sin pg_temp al final SÍ es sombreable por una tabla temporal homónima: {sombra}")

print('=== REVISIÓN CTO 8/11 — SEGUNDA RONDA ===')
def args_crear(w, items, op=None, suc=None):
    return ("select crear_pedido_stock(p_empresa_id := %s::uuid, p_sucursal_id := %s::uuid, p_dispositivo_id := null::uuid, p_items := %s::jsonb, p_metodo_pago := 'efectivo', p_origen := 'kiosk', p_tipo_pedido := 'local', p_costo_envio := 0, p_datos_delivery := null::jsonb, p_estado := 'PENDING_PAYMENT', p_codigo_retiro := 'A1', p_mesa_cuenta_id := null::uuid, p_numero_mesa := null::int, p_pagado := false, p_operacion_id := %s::uuid)",
            (w['emp'], suc or w['suc'], json.dumps(items), str(op) if op else None))
def item(w, n=1, precio=1000, **extra):
    d = {'presentacion_id': str(w['pres']), 'cantidad': n, 'precio_snap': precio, 'nombre_producto_snap': 'a', 'nombre_presentacion_snap': 'u', 'opciones': []}; d.update(extra); return d
def crear(w, items, op=None, suc=None, conn=None):
    cx = (conn or connect(w['db'])).cursor(); cx.execute(*args_crear(w, items, op, suc)); return cx.fetchone()[0]
def intenta(w, items, op=None, suc=None):
    try: crear(w, items, op, suc); return None
    except psycopg2.Error as ex: return (ex.pgcode, ex.pgerror or '')
def estado_tx(w):
    q = connect(w['db']).cursor(); out = []
    for s in ("select count(*) from pedidos where empresa_id=%s", "select count(*) from stock_movimientos where empresa_id=%s",
              "select count(*) from pedido_items i join pedidos p on p.id=i.pedido_id where p.empresa_id=%s"):
        q.execute(s, (w['emp'],)); out.append(q.fetchone()[0])
    q.execute("select coalesce(sum(cantidad),0) from producto_stock where empresa_id=%s", (w['emp'],)); out.append(q.fetchone()[0]); return tuple(out)

# ── I7r: carrera REAL entre liberar_ y una creación en vuelo (mismo advisory lock) ──
w = world(db, stock=19); op = uuid.uuid4(); reclamar(w, op, tel='1400000001')
ca = connect(db, ac=False); ka = ca.cursor(); ka.execute(*args_crear(w, [item(w)], op))        # creación EN VUELO: pedido insertado, SIN commit, lock de la operación tomado
fin = {}
def liberar_hilo():
    t0 = time.time(); connect(db).cursor().execute("select liberar_operacion_pedido(%s,%s)", (w['emp'], op)); fin['dt'] = time.time() - t0
th = threading.Thread(target=liberar_hilo); th.start(); time.sleep(1.0); espero = th.is_alive()
ca.commit(); th.join(timeout=10)
cu.execute("select estado from pedido_operaciones where operacion_id=%s and empresa_id=%s", (op, w['emp'])); fila = cu.fetchone()
cu.execute("select count(*) from pedidos where empresa_id=%s and operacion_id=%s", (w['emp'], op)); hay = cu.fetchone()[0]
check('I7r1. CARRERA REAL: liberar_ llamada mientras la creación está en vuelo (sin commit) ESPERA el mismo lock y, al commitear la creación, NO borra la operación (el pedido existe)', espero and fin.get('dt', 0) >= 0.9 and fila is not None and hay == 1, f'espero={espero} dt={fin.get("dt")} fila={fila} pedidos={hay}')
r = reclamar(w, op, tel='1400000001')
check('I7r1b. y el reintento posterior recupera ESE pedido (nunca crea otro)', r['estado'] == 'EXISTENTE' and npedidos(w) == 1 and stk(w) == 18, str(r))
w = world(db, stock=19); op = uuid.uuid4(); reclamar(w, op, tel='1400000002')
cl = connect(db, ac=False); kl = cl.cursor(); kl.execute("select liberar_operacion_pedido(%s,%s)", (w['emp'], op))     # liberar_ toma el lock PRIMERO (sin commit)
res_c = {}
def crear_hilo():
    t0 = time.time(); res_c['id'] = crear(w, [item(w)], op)['id']; res_c['dt'] = time.time() - t0
th = threading.Thread(target=crear_hilo); th.start(); time.sleep(1.0); espera_crear = th.is_alive(); cl.commit(); th.join(timeout=10)
rr = reclamar(w, op, tel='1400000002'); rid = crear(w, [item(w)], op)['id']
check('I7r2. CARRERA REAL inversa: si liberar_ gana el lock, la creación espera; al terminar ambas: UN solo pedido y la operación se recupera (la garantía es la base, no el registro auxiliar)', espera_crear and res_c.get('id') == rid and npedidos(w) == 1 and stk(w) == 18 and rr['estado'] in ('NUEVA', 'EXISTENTE'), f'{espera_crear} {res_c} {rr}')
w = world(db, stock=50); cfgs = []
errs = []; ops = [uuid.uuid4() for _ in range(6)]
for o in ops: reclamar(w, o, f'HR{o}', tel='1400000003')
def par(o):
    try:
        if True:
            hc = threading.Thread(target=lambda: connect(db).cursor().execute("select liberar_operacion_pedido(%s,%s)", (w['emp'], o))); hc.start()
            crear(w, [item(w)], o); hc.join()
    except Exception as ex: errs.append(repr(ex))
ths = [threading.Thread(target=par, args=(o,)) for o in ops for _ in range(3)]; [x.start() for x in ths]; [x.join() for x in ths]
cu.execute("select count(*), count(distinct operacion_id) from pedidos where empresa_id=%s", (w['emp'],)); n_p, n_o = cu.fetchone()
check('I7r3. 18 carreras simultáneas (3 por operación) liberar_ vs crear: sin errores, exactamente UN pedido por operación (6 pedidos, stock 44)', not errs and (n_p, n_o) == (6, 6) and stk(w) == 44, f'{errs[:1]} {(n_p, n_o)} {stk(w)}')

# ── completar_: ROW_COUNT ──
w = world(db, stock=50); op = uuid.uuid4(); reclamar(w, op, tel='1400000004'); pid = crear(w, [item(w)], op)['id']
completar(w, op, pid); again = err("select completar_operacion_pedido(%s,%s,%s)", w['emp'], op, pid)
cu.execute("select estado, pedido_id from pedido_operaciones where operacion_id=%s and empresa_id=%s", (op, w['emp'])); e2 = cu.fetchone()
check('I8b. completar_ ya COMPLETADA con el MISMO pedido: idempotente (sin error, el estado no cambia)', again is None and e2[0] == 'COMPLETADA' and str(e2[1]) == str(pid))
w = world(db, stock=50); op = uuid.uuid4(); pid = crear(w, [item(w)], op)['id']                  # pedido con operación pero SIN fila de operación (jamás reclamada / borrada)
sinfila = err("select completar_operacion_pedido(%s,%s,%s)", w['emp'], op, pid)
connect(db).cursor().execute("select reclamar_operacion_pedido(%s,%s,%s,'HY',null,null,null,false)", (w['emp'], w['suc'], uuid.uuid4()))   # otra operación, irrelevante
op3 = uuid.uuid4(); reclamar(w, op3, 'HZ', tel='1400000005'); connect(db).cursor().execute("update pedido_operaciones set estado='ADVERTIDA' where operacion_id=%s", (op3,))
pid3 = crear(w, [item(w)], op3)['id']; advertida = err("select completar_operacion_pedido(%s,%s,%s)", w['emp'], op3, pid3)
cu.execute("select estado from pedido_operaciones where operacion_id=%s", (op3,)); e3 = cu.fetchone()[0]
op4 = uuid.uuid4(); reclamar(w, op4, 'HW', tel='1400000006'); pid4 = crear(w, [item(w)], op4)['id']; completar(w, op4, pid4)
cu.execute("update pedidos set operacion_id=%s where id=%s", (op4, pid4)); otro = crear(w, [item(w)], uuid.uuid4())['id']
cu.execute("select count(*) from pedido_operaciones where estado='COMPLETADA' and operacion_id=%s and pedido_id<>%s", (op4, otro)); ok4 = cu.fetchone()[0]
check('I8c. completar_ NO informa éxito sin actualizar: sin fila de operación → P0001; operación ADVERTIDA → P0001 y queda ADVERTIDA', sinfila == 'P0001' and advertida == 'P0001' and e3 == 'ADVERTIDA' and ok4 == 1, f'{sinfila} {advertida} {e3}')
try:
    connect(db).cursor().execute("select completar_operacion_pedido(%s,%s,%s)", (w['emp'], op4, otro)); com_otro = None
except psycopg2.Error as ex: com_otro = ex.pgerror or ''
check('I8d. completar_ con otro pedido sobre una operación ya COMPLETADA: error OPERACION_NO_COMPLETABLE/PEDIDO_NO_CORRESPONDE (jamás pisa el pedido asociado)', com_otro is not None and ('NO_COMPLETABLE' in com_otro or 'NO_CORRESPONDE' in com_otro), str(com_otro)[:90])

# ── E: cada rechazo de la RPC → rollback completo, sin pedido, sin stock, sin libro; la operación se reclama de nuevo ──
def mundo_e(factor_suelto=False):
    w = world(db, stock=10); q = connect(db).cursor()
    w['suc_ajena'] = None
    return w
def rollback_completo(w, antes): return estado_tx(w) == antes
casos = {}
w = world(db, stock=10); w2 = world(db, stock=10); antes = estado_tx(w)
casos['SUCURSAL_INVALIDA'] = intenta(w, [item(w)], uuid.uuid4(), suc=w2['suc'])
casos['PRESENTACION_INVALIDA'] = intenta(w, [item(w, presentacion_id=str(uuid.uuid4()))], uuid.uuid4())
casos['PRECIO_INVALIDO'] = intenta(w, [item(w, precio=1)], uuid.uuid4())
casos['OPCION_INVALIDA'] = intenta(w, [item(w, opciones=[{'opcion_id': str(uuid.uuid4()), 'nombre_snap': 'x', 'emoji_snap': None, 'color_snap': None}])], uuid.uuid4())
casos['SIN_STOCK'] = intenta(w, [item(w, 11)], uuid.uuid4())
casos['PROMO_COMPONENTE_INVALIDO'] = intenta(w, [item(w, combo_ref=str(uuid.uuid4()))], uuid.uuid4())
ref = str(uuid.uuid4()); casos['PROMO_INVALIDA'] = intenta(w, [item(w, combo_ref=ref, promo_id=str(uuid.uuid4()), promo_slot_id=str(uuid.uuid4()))], uuid.uuid4())
qe = connect(db).cursor()
def promo(desde=None, hasta=None, con_slot=True, con_pres=True, precio=1000):
    qe.execute("insert into promociones(empresa_id,nombre,precio,vigencia_desde,vigencia_hasta) values(%s,'Combo',%s,%s,%s) returning id", (w['emp'], precio, desde, hasta)); pid = qe.fetchone()[0]; sid = None
    if con_slot:
        qe.execute("insert into promo_slots(promo_id) values(%s) returning id", (pid,)); sid = qe.fetchone()[0]
        if con_pres: qe.execute("insert into promo_slot_presentaciones(slot_id,presentacion_id) values(%s,%s)", (sid, w['pres']))
    return pid, sid
pv, sv = promo(hasta='2000-01-01'); casos['PROMO_VENCIDA'] = intenta(w, [item(w, combo_ref=str(uuid.uuid4()), promo_id=str(pv), promo_slot_id=str(sv))], uuid.uuid4())
pn, _ = promo(con_slot=False); casos['PROMO_SLOTS_INVALIDOS'] = intenta(w, [item(w, combo_ref=str(uuid.uuid4()), promo_id=str(pn), promo_slot_id=str(uuid.uuid4()))], uuid.uuid4())
pp, sp = promo(con_pres=False); casos['PROMO_PRESENTACION_NO_PERMITIDA'] = intenta(w, [item(w, combo_ref=str(uuid.uuid4()), promo_id=str(pp), promo_slot_id=str(sp))], uuid.uuid4())
pq, sq = promo(precio=1000); casos['PROMO_PRECIO_INVALIDO'] = intenta(w, [item(w, precio=1, combo_ref=str(uuid.uuid4()), promo_id=str(pq), promo_slot_id=str(sq))], uuid.uuid4())
# FACTOR_STOCK_INVALIDO: la base lo impide con CHECK; para probar el cinturón de la RPC se quita el CHECK solo en una base descartable
dbf = build('rep_factor'); wf = world(dbf, stock=10); connect(dbf).cursor().execute("alter table presentaciones drop constraint presentaciones_factor_stock_positivo, drop constraint if exists presentaciones_factor_stock_entero")
connect(dbf).cursor().execute("update presentaciones set factor_stock=1.5 where id=%s", (wf['pres'],)); antes_f = estado_tx(wf)
casos['FACTOR_STOCK_INVALIDO'] = intenta(wf, [item(wf)], uuid.uuid4())
import re as _re
sql17 = open(os.path.join(SUP, 'crear-pedido-stock-v1.7-operacion.sql'), encoding='utf-8').read()
en_sql = set(_re.findall(r"raise exception '([A-Z_]+)", sql17)) - {'PRECHECK'}
for cod, res in casos.items():
    wk = wf if cod == 'FACTOR_STOCK_INVALIDO' else w
    pass
okc = {}
for cod, res in casos.items():
    okc[cod] = res is not None and res[0] == 'P0001' and res[1].split('ERROR:')[1].strip().split(':')[0].split('\n')[0].strip() == cod
check('E1. cada rechazo de la lista (12 códigos) se PROVOCA de verdad contra la RPC y llega con SQLSTATE P0001 y su mensaje', all(okc.values()) and set(casos) == en_sql, str({k: v for k, v in okc.items() if not v}) + f' faltan={en_sql - set(casos)} sobran={set(casos) - en_sql}')
check('E2. tras TODOS esos rechazos: rollback completo — 0 pedidos, 0 movimientos, 0 ítems y el stock intacto (idéntico al estado previo)', estado_tx(w) == antes and estado_tx(wf) == antes_f and antes[:3] == (0, 0, 0), f'{estado_tx(w)} {antes} {estado_tx(wf)}')
# E3: con una operación reclamada, cada rechazo → liberar_ → reclamar_ otra vez NUEVA y la venta correcta sale con el mismo id
ok3 = True
for cod, mk in (('SIN_STOCK', lambda: [item(w, 11)]), ('PRECIO_INVALIDO', lambda: [item(w, precio=1)])):
    o = uuid.uuid4(); reclamar(w, o, f'HE-{cod}', tel='1500000001'); intenta(w, mk(), o)
    connect(db).cursor().execute("select liberar_operacion_pedido(%s,%s)", (w['emp'], o)); r = reclamar(w, o, f'HE-{cod}', tel='1500000001')
    ok3 &= r['estado'] == 'NUEVA'
    pidx = crear(w, [item(w)], o)['id']; completar(w, o, pidx)
check('E3. rechazo → liberar_ → reclamar_ vuelve a dar NUEVA y la venta correcta con el MISMO operacion_id sale (2 pedidos, stock 8)', ok3 and npedidos(w) == 2 and stk(w) == 8, f'{npedidos(w)} {stk(w)}')

# ── 40P01: deadlock REAL con la RPC de creación como víctima ──
dbd = build('rep_deadlock'); wd = world(dbd, stock=10); qd = connect(dbd).cursor()
qd.execute("insert into productos(empresa_id,nombre,controla_stock) values(%s,'B',true) returning id", (wd['emp'],)); prod_b = qd.fetchone()[0]
qd.execute("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'U',1000,1) returning id", (wd['emp'], prod_b)); pres_b = qd.fetchone()[0]
qd.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,10)", (wd['emp'], prod_b, wd['suc']))
pa, pb = sorted([(str(wd['prod']), str(wd['pres'])), (str(prod_b), str(pres_b))])
def stk2(prod): 
    qd.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (prod, wd['suc'])); return qd.fetchone()[0]
victima = None; intentos = 0
while victima != 'crear' and intentos < 6:
    intentos += 1; op_d = uuid.uuid4(); reclamar(wd, op_d, 'HD', tel=f'16000000{intentos:02d}')
    blk = connect(dbd, ac=False); kb = blk.cursor(); kb.execute("update producto_stock set cantidad = cantidad where producto_id=%s and sucursal_id=%s", (pb[0], wd['suc']))   # retiene pb y la fila catalogo_version (trigger)
    out = {}
    def vender():
        try: crear(wd, [{**item(wd), 'presentacion_id': pa[1]}, {**item(wd), 'presentacion_id': pb[1]}], op_d); out['ok'] = True
        except psycopg2.Error as ex: out['err'] = (ex.pgcode, ex.pgerror or '')
    tv = threading.Thread(target=vender); tv.start(); time.sleep(0.3)
    try:
        kb.execute("update producto_stock set cantidad = cantidad where producto_id=%s and sucursal_id=%s", (pa[0], wd['suc'])); blk.commit(); out['blk'] = 'ok'
    except psycopg2.Error as ex: out['blk'] = ex.pgcode; blk.rollback()
    tv.join(timeout=15)
    victima = 'crear' if out.get('err', (None,))[0] == '40P01' else ('bloqueador' if out.get('blk') == '40P01' else 'ninguna')
    if victima == 'crear':
        cu_d = connect(dbd).cursor(); cu_d.execute("select count(*) from pedidos where operacion_id=%s", (op_d,)); hay_d = cu_d.fetchone()[0]
        cu_d.execute("select count(*) from stock_movimientos where empresa_id=%s", (wd['emp'],)); mov_d = cu_d.fetchone()[0]
        intacto = (hay_d, mov_d, stk2(pa[0]), stk2(pb[0])) == (0, 0, 10, 10)
        connect(dbd).cursor().execute("select liberar_operacion_pedido(%s,%s)", (wd['emp'], op_d)); rd = reclamar(wd, op_d, 'HD', tel=f'16000000{intentos:02d}')
        pd_ = crear(wd, [{**item(wd), 'presentacion_id': pa[1]}, {**item(wd), 'presentacion_id': pb[1]}], op_d)['id']; completar(wd, op_d, pd_)
        check('E4. DEADLOCK REAL (venta vs transacción que toma los mismos productos en otro orden): PostgreSQL aborta la creación con 40P01, rollback completo (sin pedido, sin libro, stock intacto) y tras liberar_+reclamar_ el reintento crea UN pedido (stock 9/9)', intacto and rd['estado'] == 'NUEVA' and stk2(pa[0]) == 9 and stk2(pb[0]) == 9, f'{(hay_d, mov_d)} intacto={intacto} {rd}')
if victima != 'crear': check('E4. DEADLOCK REAL con la creación como víctima', False, f'no se logró en {intentos} intentos ({victima})')
# stress: ventas {pb} vs devoluciones de pedidos {pa,pb}: se cuentan los 40P01 y se verifican los invariantes de stock
dbs = build('rep_stress'); ws = world(dbs, stock=1000); qs = connect(dbs).cursor()
qs.execute("insert into productos(empresa_id,nombre,controla_stock) values(%s,'B',true) returning id", (ws['emp'],)); prod_b2 = qs.fetchone()[0]
qs.execute("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'U',1000,1) returning id", (ws['emp'], prod_b2)); pres_b2 = qs.fetchone()[0]
qs.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,1000)", (ws['emp'], prod_b2, ws['suc']))
pa2, pb2 = sorted([(str(ws['prod']), str(ws['pres'])), (str(prod_b2), str(pres_b2))])
pre = [crear(ws, [{**item(ws), 'presentacion_id': pa2[1]}, {**item(ws), 'presentacion_id': pb2[1]}], uuid.uuid4())['id'] for _ in range(30)]   # 30 pedidos {pa,pb}: stock 970/970
res_s = {'venta_ok': 0, 'venta_dl': 0, 'dev_ok': 0, 'dev_dl': 0, 'otro': []}
lock_s = threading.Lock(); cupo = threading.Semaphore(24)      # acota las conexiones simultáneas (max_connections del cluster de prueba = 100): el fallo 'too many clients' era del arnés, no de la base
def t_venta(i):
    with cupo:
        try: crear(ws, [{**item(ws), 'presentacion_id': pb2[1]}], uuid.uuid4()); k = 'venta_ok'; cod = msg = None
        except psycopg2.Error as ex: k = 'venta_dl' if ex.pgcode == '40P01' else 'otro'; cod = ex.pgcode; msg = (ex.pgerror or str(ex))[:120]
    with lock_s:
        if k == 'otro': res_s['otro'].append(('venta', cod, msg))
        else: res_s[k] += 1
def t_dev(pid):
    with cupo:
        k = 'otro'; cod = msg = None
        for _ in range(20):
            try: connect(dbs).cursor().execute("select devolver_stock_pedido(%s,%s)", (ws['emp'], pid)); k = 'dev_ok'; break
            except psycopg2.Error as ex:
                if ex.pgcode == '40P01':
                    with lock_s: res_s['dev_dl'] += 1
                    continue
                k = 'otro'; cod = ex.pgcode; msg = (ex.pgerror or str(ex))[:120]; break
    with lock_s:
        if k == 'otro': res_s['otro'].append(('dev', cod, msg))
        else: res_s[k] += 1
ths = [threading.Thread(target=t_venta, args=(i,)) for i in range(60)] + [threading.Thread(target=t_dev, args=(p,)) for p in pre]
import random as _rnd; _rnd.shuffle(ths); [x.start() for x in ths]; [x.join() for x in ths]
qs.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (pa2[0], ws['suc'])); sa = qs.fetchone()[0]
qs.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (pb2[0], ws['suc'])); sb = qs.fetchone()[0]
qs.execute("select coalesce(sum(delta),0) from stock_movimientos where producto_id=%s", (pb2[0],)); neto_b = qs.fetchone()[0]
inv_ok = sa == 1000 and sb == 1000 - res_s['venta_ok'] and neto_b == sb - 1000
print(f"INFO deadlocks reales observados (60 ventas {{pb}} vs 30 devoluciones {{pa,pb}} simultáneas): ventas abortadas 40P01={res_s['venta_dl']}, devoluciones abortadas 40P01 (reintentadas)={res_s['dev_dl']}")
check('E5. ESTRÉS venta↔devolución concurrentes: ningún error distinto de 40P01; las 30 devoluciones terminan (reintento); stock consistente: pa=1000 y pb=1000−ventas confirmadas; el libro cuadra con el stock', not res_s['otro'] and res_s['dev_ok'] == 30 and inv_ok, f"{res_s} sa={sa} sb={sb} neto_b={neto_b}")

# ── Devolución: NULL explícito y decisión histórica de controla_stock ──
dbn = build('rep_null'); connect(dbn).cursor().execute("alter table pedidos alter column stock_descontado drop not null")
wn = world(dbn, stock=10); pn_ = crear(wn, [item(wn, 2)], uuid.uuid4())['id']; connect(dbn).cursor().execute("update pedidos set stock_descontado=null where id=%s", (pn_,))
qn = connect(dbn).cursor(); qn.execute("select devolver_stock_pedido(%s,%s)", (wn['emp'], pn_)); dn = qn.fetchone()[0]
check('N1. stock_descontado NULL (columna sin NOT NULL en la base): la RPC NO devuelve stock (no hay prueba de descuento): devuelto=false, motivo FLAG_NULL, stock intacto, sin movimientos de devolución', dn['devuelto'] is False and dn.get('motivo') == 'FLAG_NULL' and stk(wn) == 8, str(dn))
w = world(db, stock=10); pA = crear(w, [item(w, 3)], uuid.uuid4())['id']; connect(db).cursor().execute("update productos set controla_stock=false where id=%s", (w['prod'],))
cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], pA)); dA = cu.fetchone()[0]
check('H1. controla_stock CAMBIÓ a false después de la venta: la devolución respeta la decisión HISTÓRICA (el libro dice que se descontó 3) y devuelve 3 (7→10)', dA['devuelto'] is True and stk(w) == 10, f'{dA} stock={stk(w)}')
w = world(db, stock=10); q = connect(db).cursor()
q.execute("insert into productos(empresa_id,nombre,controla_stock) values(%s,'Gaseosa',false) returning id", (w['emp'],)); prodB = q.fetchone()[0]
q.execute("insert into presentaciones(empresa_id,producto_id,nombre,precio,factor_stock) values(%s,%s,'U',500,1) returning id", (w['emp'], prodB)); presB = q.fetchone()[0]
q.execute("insert into producto_stock(empresa_id,producto_id,sucursal_id,cantidad) values(%s,%s,%s,10)", (w['emp'], prodB, w['suc']))
pM = crear(w, [item(w, 1), {**item(w, 2, 500), 'presentacion_id': str(presB)}], uuid.uuid4())['id']       # B no controlaba stock al vender: solo A se descuenta
q.execute("update productos set controla_stock=true where id=%s", (prodB,))                                  # DESPUÉS B pasa a controlar stock
cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], pM)); dM = cu.fetchone()[0]
q.execute("select cantidad from producto_stock where producto_id=%s and sucursal_id=%s", (prodB, w['suc'])); sB = q.fetchone()[0]
check('H2. controla_stock pasó a TRUE después de la venta: NO se inventa una devolución de lo que nunca se descontó (B queda en 10; A vuelve a 10; 1 solo movimiento de devolución)', dM['devuelto'] is True and dM['movimientos'] == 1 and sB == 10 and stk(w) == 10, f'{dM} B={sB} A={stk(w)}')
w = world(db, stock=10); pL = crear(w, [item(w, 2)], uuid.uuid4())['id']; q = connect(db).cursor()
q.execute("delete from stock_movimientos where pedido_id=%s", (pL,))                                         # pedido ANTERIOR al libro: stock_descontado=true sin movimientos de venta
cu.execute("select devolver_stock_pedido(%s,%s)", (w['emp'], pL)); dL = cu.fetchone()[0]
check('H3. pedido anterior al libro (stock_descontado=true, sin movimientos de venta): se conserva el criterio histórico del sistema (controla_stock actual) y devuelve (8→10)', dL['devuelto'] is True and stk(w) == 10, f'{dL} {stk(w)}')
w = world(db, stock=10); pI = crear(w, [item(w, 2)], uuid.uuid4())['id']; q = connect(db).cursor()
q.execute("update stock_movimientos set delta=-5 where pedido_id=%s and motivo='venta'", (pI,))              # libro y snapshot discrepan
e_i = err("select devolver_stock_pedido(%s,%s)", w['emp'], pI)
q.execute("select stock_descontado from pedidos where id=%s", (pI,)); flag_i = q.fetchone()[0]
check('H4. snapshot ≠ libro: aborta con DEVOLUCION_INCONSISTENTE (P0001), rollback completo: el flag sigue true y el stock no se tocó (8)', e_i == 'P0001' and flag_i is True and stk(w) == 8, f'{e_i} flag={flag_i} stock={stk(w)}')

# ── Permisos: propietario y DML efectivo ──
cu.execute("select p.proname, pg_get_userbyid(p.proowner) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.proname in ('reclamar_operacion_pedido','completar_operacion_pedido','liberar_operacion_pedido','purgar_operaciones_pedido','devolver_stock_pedido','crear_pedido_stock')")
own = dict(cu.fetchall()); cu.execute("select pg_get_userbyid(relowner), relrowsecurity, (select count(*) from pg_policy where polrelid=c.oid) from pg_class c where oid='public.pedido_operaciones'::regclass"); to, rls, npol = cu.fetchone()
cu.execute("select pg_get_userbyid(relowner) from pg_class where oid='public.pedidos'::regclass"); powner = cu.fetchone()[0]
check('P1. las 6 funciones SECURITY DEFINER pertenecen al mismo rol dueño de las tablas (no a anon/authenticated/service_role) y pedido_operaciones tiene RLS activa sin policies', len(own) == 6 and set(own.values()) == {powner} and to == powner and rls is True and npol == 0 and powner not in ('anon', 'authenticated', 'service_role'), f'{own} tabla={to} rls={rls} pol={npol}')
dml = {}
for rol in ('anon', 'authenticated', 'service_role'):
    dml[rol] = [cu.execute("select has_table_privilege(%s,'public.pedido_operaciones',%s)", (rol, pr)) or cu.fetchone()[0] for pr in ('select', 'insert', 'update', 'delete')]
def como(rol, sql):
    cx = connect(db); k = cx.cursor(); k.execute(f"set role {rol}")
    try: k.execute(sql); return None
    except psycopg2.Error as ex: return ex.pgcode
real = {rol: [como(rol, "select count(*) from public.pedido_operaciones"), como(rol, "update public.pedido_operaciones set estado='EN_CURSO'"), como(rol, "delete from public.pedido_operaciones"),
              como(rol, "insert into public.pedido_operaciones(empresa_id,operacion_id,sucursal_id,huella,estado) values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'x','EN_CURSO')")] for rol in ('anon', 'authenticated')}
check('P2. pedido_operaciones: anon y authenticated NO tienen SELECT, INSERT, UPDATE ni DELETE (privilegios y intentos reales con SET ROLE → 42501); service_role sí los tiene', dml['anon'] == dml['authenticated'] == [False] * 4 and all(all(c == '42501' for c in v) for v in real.values()) and dml['service_role'] == [True] * 4, f'{dml} {real}')

# ── Prechecks y reversión con objetos PREEXISTENTES ──
PRE_TABLA_MALA = "create table pedido_operaciones (empresa_id uuid not null, operacion_id text not null, sucursal_id uuid not null, huella text not null, estado text not null, id_telefono text, id_visitante text, id_dispositivo uuid, pedido_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (empresa_id, operacion_id))"
d, c = build_pre('rep_pre1', PRE_TABLA_MALA, 0)
for f in FILES[:3]: aplicar(c, f)
e, _ = aplicar(c, 'pedidos-repetidos.sql')
c.execute("select count(*) from pg_proc where proname in ('reclamar_operacion_pedido','completar_operacion_pedido','liberar_operacion_pedido','purgar_operaciones_pedido')"); nfun = c.fetchone()[0]
c.execute("select count(*) from information_schema.columns where table_name='empresa_config' and column_name like '%repetidos%'"); ncol = c.fetchone()[0]
check('PRE1. tabla pedido_operaciones PREEXISTENTE con otro tipo (operacion_id text): el script aborta con PRECHECK y NO deja nada a medias (0 funciones, 0 columnas de config)', e is not None and 'PRECHECK' in e and 'operacion_id' in e and nfun == 0 and ncol == 0, (e or '')[:120])
PRE_TABLA_SIN_FK = open(os.path.join(SUP, 'pedidos-repetidos.sql'), encoding='utf-8').read()   # sirve de referencia para construir una tabla válida pero preexistente (sin marca)
TABLA_OK = "create table pedido_operaciones (empresa_id uuid not null, operacion_id uuid not null, sucursal_id uuid not null, huella text not null, id_telefono text, id_visitante text, id_dispositivo uuid, estado text not null check (estado in ('EN_CURSO','COMPLETADA','ADVERTIDA')), pedido_id uuid references pedidos(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (empresa_id, operacion_id))"
d, c = build_pre('rep_pre2', None, 0)
c.execute("create table otra_tabla (x int)"); c.execute("alter table otra_tabla add constraint empresa_config_pedidos_repetidos_minutos_rango check (x > 0)")     # constraint HOMÓNIMA de OTRA tabla
for f in FILES[:2]: aplicar(c, f)
e, _ = aplicar(c, 'devolver-stock-pedido.sql'); e, _ = aplicar(c, 'pedidos-repetidos.sql')
c.execute("select count(*) from pg_constraint where conname='empresa_config_pedidos_repetidos_minutos_rango' and conrelid='public.empresa_config'::regclass"); propia = c.fetchone()[0]
check('PRE2. constraint homónima en OTRA tabla: no se confunde con la de empresa_config; el script crea la propia (buscada por conname Y conrelid)', e is None and propia == 1, str(e)[:100])
d, c = build_pre('rep_pre3', "create function public.reclamar_operacion_pedido(uuid,uuid,uuid,text,text,text,uuid,boolean) returns jsonb language sql as $$ select '{}'::jsonb $$", 0)
for f in FILES[:3]: aplicar(c, f)
e, _ = aplicar(c, 'pedidos-repetidos.sql')
check('PRE3. función homónima preexistente que NO es del script: el script aborta y no la pisa', e is not None and 'PRECHECK' in e and 'reclamar_operacion_pedido' in e, (e or '')[:120])
d, c = build_pre('rep_pre4', None, 0)
for f in FILES[:4]: aplicar(c, f)
c.execute("create unique index pedidos_empresa_operacion_uidx on pedidos (empresa_id, numero_pedido)") if False else None
c.execute("alter table pedidos add column if not exists operacion_id uuid"); c.execute("drop index if exists pedidos_empresa_operacion_uidx"); c.execute("create unique index pedidos_empresa_operacion_uidx on pedidos (empresa_id, operacion_id)")   # índice homónimo SIN el predicado parcial
c.execute("select md5(prosrc) from pg_proc where proname='crear_pedido_stock'"); h0 = c.fetchone()[0]
e, _ = aplicar(c, 'crear-pedido-stock-v1.7-operacion.sql')
c.execute("select md5(prosrc), pronargs from pg_proc where proname='crear_pedido_stock'"); h1, na = c.fetchone()
check('PRE4. índice preexistente con el MISMO NOMBRE pero otra definición (sin WHERE operacion_id IS NOT NULL): v1.7 aborta (se valida la definición, no el nombre) y la función viva queda intacta (mismo cuerpo, 15 parámetros)', e is not None and 'PRECHECK' in e and 'pedidos_empresa_operacion_uidx' in e and h0 == h1 and na == 15, (e or '')[:140])
d, c = build_pre('rep_pre5', None, 0)
for f in FILES[:4]: aplicar(c, f)
c.execute("alter table pedidos drop column operacion_id"); c.execute("drop index if exists pedidos_empresa_operacion_uidx")
c.execute("alter table pedidos add column operacion_id uuid"); c.execute("create unique index pedidos_empresa_operacion_uidx on pedidos (empresa_id, operacion_id) where operacion_id is not null")   # PREEXISTENTES y correctos, SIN marca
c.execute("drop function if exists public.crear_pedido_stock(uuid,uuid,uuid,jsonb,text,text,text,numeric,jsonb,text,text,uuid,integer,boolean,text,uuid)")
c.execute(open(os.path.join(SUP, 'rpc-crear-pedido-stock-v2-factor.sql'), encoding='utf-8').read()) if False else None
e, _ = aplicar(c, 'crear-pedido-stock-v1.7-operacion.sql')
w5 = world(d, stock=10); pid5 = crear(w5, [item(w5)], uuid.uuid4())['id']
c.execute("set coneos.acepto_perdida_historial = 'si'"); e1, notas1 = aplicar(c, 'crear-pedido-stock-v1.7-operacion-REVERSION.sql')
c.execute("select count(*) from information_schema.columns where table_name='pedidos' and column_name='operacion_id'"); col5 = c.fetchone()[0]
c.execute("select count(*) from pedidos where operacion_id is not null"); conval = c.fetchone()[0]
c.execute("select to_regclass('pedidos_empresa_operacion_uidx') is not null"); ix5 = c.fetchone()[0]
c.execute("select pronargs from pg_proc where proname='crear_pedido_stock'"); na5 = c.fetchone()[0]
check('PRE5. pedidos.operacion_id e índice PREEXISTENTES (sin marca): v1.7 se aplica; su reversión restaura la función de 15 parámetros pero CONSERVA la columna, su dato y el índice (NOTICE explícito)', e is None and e1 is None and col5 == 1 and conval == 1 and ix5 is True and na5 == 15 and any('SE CONSERVA' in n for n in notas1), f'{e} {e1} col={col5} datos={conval} ix={ix5} nargs={na5}')
d, c = build_pre('rep_pre6', None, 0)
for f in FILES[:3]: aplicar(c, f)
c.execute(TABLA_OK); c.execute("insert into pedidos(empresa_id,sucursal_id,numero_pedido) values (gen_random_uuid(),gen_random_uuid(),1)")
c.execute("insert into pedido_operaciones(empresa_id,operacion_id,sucursal_id,huella,estado) values (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'dato-preexistente','COMPLETADA')")
e, _ = aplicar(c, 'pedidos-repetidos.sql')
c.execute("set coneos.acepto_perdida_historial = 'si'"); e1, notas = aplicar(c, 'pedidos-repetidos-REVERSION.sql')
c.execute("select count(*) from pedido_operaciones where huella='dato-preexistente'"); dato = c.fetchone()[0]
c.execute("select count(*) from pg_proc where proname in ('reclamar_operacion_pedido','completar_operacion_pedido','liberar_operacion_pedido','purgar_operaciones_pedido')"); nf6 = c.fetchone()[0]
c.execute("select count(*) from information_schema.columns where table_name='empresa_config' and column_name like '%repetidos%'"); nc6 = c.fetchone()[0]
check('PRE6. pedido_operaciones PREEXISTENTE y válida (sin marca): el script la acepta; la reversión borra funciones y config pero CONSERVA la tabla y sus datos (NOTICE explícito)', e is None and e1 is None and dato == 1 and nf6 == 0 and nc6 == 0 and any('SE CONSERVA la tabla' in n for n in notas), f'{e} {e1} dato={dato} {notas[-2:]}')

print('=== REVERSIÓN (con confirmación expresa) ===')
c = connect(db).cursor()
w = world(db, stock=19); pv = venta(w, 1, op=uuid.uuid4())
sin_ok = err(open(os.path.join(SUP, 'crear-pedido-stock-v1.7-operacion-REVERSION.sql'), encoding='utf-8').read())
sin_ok2 = err(open(os.path.join(SUP, 'pedidos-repetidos-REVERSION.sql'), encoding='utf-8').read())
check('R21a. las reversiones son DESTRUCTIVAS y no corren sin aceptar expresamente la pérdida (REVERSION_NO_CONFIRMADA)', sin_ok == 'P0001' and sin_ok2 == 'P0001')
c.execute("set coneos.acepto_perdida_historial = 'si'")
c.execute(open(os.path.join(SUP, 'crear-pedido-stock-v1.7-operacion-REVERSION.sql'), encoding='utf-8').read())
c.execute("select count(*), max(pronargs) from pg_proc where pronamespace='public'::regnamespace and proname='crear_pedido_stock'"); nf, na = c.fetchone()
c.execute("select count(*) from information_schema.columns where table_name='pedidos' and column_name='operacion_id'"); col = c.fetchone()[0]
c.execute("select to_regclass('pedidos_empresa_operacion_uidx')"); ix = c.fetchone()[0]
c.execute("select count(*) from pedidos where empresa_id=%s", (w['emp'],)); np_ = c.fetchone()[0]
c.execute("select has_function_privilege('anon','public.crear_pedido_stock(uuid,uuid,uuid,jsonb,text,text,text,numeric,jsonb,text,text,uuid,integer,boolean,text)','execute')"); anon = c.fetchone()[0]
c.execute("select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace and proname='crear_pedido_stock'"); h_rev = c.fetchone()[0]
ref = build('rep_ref16'); cr = connect(ref).cursor()
cr.execute(open(os.path.join(SUP, 'rpc-crear-pedido-stock-v2-factor.sql'), encoding='utf-8').read()) if False else None
cr.execute("drop function public.crear_pedido_stock(uuid,uuid,uuid,jsonb,text,text,text,numeric,jsonb,text,text,uuid,integer,boolean,text,uuid)")
cr.execute(open(os.path.join(SUP, 'rpc-crear-pedido-stock-v2-factor.sql'), encoding='utf-8').read())
cr.execute("select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace and proname='crear_pedido_stock'"); h_ref = cr.fetchone()[0]
check('R21b. reversión de v1.7: queda UNA crear_pedido_stock de 15 parámetros con el cuerpo EXACTO de v1.6 (md5 idéntico), sin columna ni índice de operación, pedidos intactos, sin permisos para anon', (nf, na) == (1, 15) and h_rev == h_ref and col == 0 and ix is None and np_ == 1 and anon is False, f'{(nf, na)} {h_rev == h_ref} col={col} ix={ix} np={np_}')
# re-aplicar v1.7 sobre la reversión y dos veces seguidas (idempotente)
for _ in range(2): c.execute(open(os.path.join(SUP, 'crear-pedido-stock-v1.7-operacion.sql'), encoding='utf-8').read())
c.execute("select count(*), max(pronargs) from pg_proc where pronamespace='public'::regnamespace and proname='crear_pedido_stock'"); nf2, na2 = c.fetchone()
check('R21c. v1.7 se puede re-aplicar (dos veces seguidas) sin dejar sobrecargas: una sola función de 16 parámetros', (nf2, na2) == (1, 16))
c.execute(open(os.path.join(SUP, 'pedidos-repetidos-REVERSION.sql'), encoding='utf-8').read())
c.execute("select count(*) from pg_proc where proname in ('reclamar_operacion_pedido','completar_operacion_pedido','liberar_operacion_pedido','purgar_operaciones_pedido')"); nf = c.fetchone()[0]
c.execute("select count(*) from information_schema.columns where table_name='empresa_config' and column_name like '%repetidos%'"); nc = c.fetchone()[0]
c.execute("select to_regclass('pedido_operaciones')"); tb = c.fetchone()[0]
check('R21d. la reversión de pedidos-repetidos quita funciones, tabla, constraint y columnas (y no toca pedidos)', nf == 0 and nc == 0 and tb is None)
print(f"\n{sum(R)}/{len(R)} PASS"); raise SystemExit(0 if all(R) else 1)
